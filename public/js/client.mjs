import { applyOperations, coalesce, defaultState, format, MAX_RANGE, MIN_RANGE, parseScalar, transform, validateState } from '/shared/model.mjs';

export const uid = () => globalThis.crypto?.randomUUID?.() || ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const vectorName = (vector, output = false) => (output ? 'Av' : 'v') + String(vector.number).replace(/\d/g, (digit) => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]);
export class Store extends EventTarget {
  constructor() {
    super();
    this.clientId = uid();
    this.base = defaultState();
    this.state = this.base;
    this.ready = false;
    this.online = false;
    this.queue = [];
    this.inflight = null;
    this.seq = 0;
    this.timer = null;
    this.listeners = new Set();
  }
  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.state);
    return () => this.listeners.delete(callback);
  }
  emit() {
    for (const listener of this.listeners) listener(this.state);
    this.status();
  }
  status() {
    this.dispatchEvent(new CustomEvent('status', { detail: {
      ready: this.ready, online: this.online,
      pending: Boolean(this.queue.length || this.inflight),
    } }));
  }
  report(message) { this.dispatchEvent(new CustomEvent('problem', { detail: message })); }
  rebuild() {
    let next = this.base;
    const operations = [...(this.inflight && !this.inflight.acked ? this.inflight.operations : []), ...this.queue];
    for (const operation of operations) {
      // A concurrent deletion or an already acknowledged addition need not break rendering.
      try { next = applyOperations(next, [operation]); } catch { /* Server reports rejected writes. */ }
    }
    this.state = next;
    this.emit();
  }
  accept(payload) {
    validateState(payload.state);
    if (this.inflight && payload.ackSeq >= this.inflight.seq) this.inflight.acked = true;
    if (!this.ready || payload.state.revision >= this.base.revision) this.base = payload.state;
    this.ready = true;
    this.rebuild();
  }
  mutate(operations) {
    if (!this.ready) { this.report('正在连接服务器，请稍候'); return false; }
    const list = Array.isArray(operations) ? operations : [operations];
    try { applyOperations(this.state, list); }
    catch (problem) { this.report(problem.message); return false; }
    for (const operation of list) coalesce(this.queue, operation);
    this.rebuild();
    this.schedule(60);
    return true;
  }
  schedule(delay) {
    if (this.timer || this.inflight) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, delay);
  }
  flush() {
    if (this.inflight || !this.queue.length) return;
    this.inflight = { seq: ++this.seq, operations: this.queue.splice(0, 64), acked: false };
    this.send();
  }
  async send() {
    const batch = this.inflight;
    if (!batch) return;
    this.status();
    try {
      const response = await fetch('/api/state', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: this.clientId, seq: batch.seq, operations: batch.operations }),
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error(payload.error || '保存失败'), { status: response.status });
      this.accept(payload);
      this.inflight = null;
      this.rebuild();
      this.schedule(60);
    } catch (problem) {
      if (problem.status >= 400 && problem.status < 500) {
        this.inflight = null;
        this.rebuild();
        this.report(problem.message);
        this.schedule(60);
      } else {
        this.online = false;
        this.status();
        // Retry the same sequence. Commands are idempotent and the server deduplicates.
        setTimeout(() => { if (this.inflight === batch) this.send(); }, 1500);
      }
    }
  }
  async start() {
    try {
      const response = await fetch('/api/state?client=' + encodeURIComponent(this.clientId), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('无法读取服务器数据');
      this.accept(await response.json());
      this.events = new EventSource('/api/events?client=' + encodeURIComponent(this.clientId));
      this.events.addEventListener('open', () => { this.online = true; this.status(); });
      this.events.addEventListener('state', (event) => {
        try { this.accept(JSON.parse(event.data)); }
        catch { this.report('收到的数据格式有误，请刷新页面'); }
      });
      this.events.addEventListener('error', () => { this.online = false; this.status(); });
    } catch {
      this.online = false;
      this.status();
      setTimeout(() => this.start(), 2500);
    }
  }
}
export function bindCommon(store, plot) {
  const status = document.getElementById('connection');
  const message = document.getElementById('toast');
  const range = document.getElementById('range');
  const rangeMinus = document.getElementById('range-minus');
  const rangePlus = document.getElementById('range-plus');
  store.addEventListener('status', (event) => {
    const value = event.detail;
    const text = !value.ready ? '正在连接' : !value.online ? (value.pending ? '等待保存 · 正在重连' : '正在重连') : value.pending ? '正在保存' : '已同步';
    status.querySelector('span').textContent = text;
    status.dataset.mode = !value.online ? 'waiting' : value.pending ? 'saving' : 'online';
    range.disabled = !value.ready;
    rangeMinus.disabled = !value.ready || store.state.view.range <= MIN_RANGE;
    rangePlus.disabled = !value.ready || store.state.view.range >= MAX_RANGE;
  });
  let toastTimer;
  store.addEventListener('problem', (event) => {
    clearTimeout(toastTimer);
    message.textContent = event.detail;
    message.hidden = false;
    toastTimer = setTimeout(() => { message.hidden = true; }, 5500);
  });
  const updateRange = () => {
    const state = store.state;
    if (document.activeElement !== range) range.value = String(state.view.range);
    const view = plot.view;
    const visibleRange = document.getElementById('visible-range');
    if (visibleRange) visibleRange.textContent = 'x ±' + format(view.xRange, 2) + ' · y ±' + format(view.yRange, 2);
    const outside = state.vectors.some((vector) => {
      const output = transform(state.matrix, vector);
      return Math.abs(vector.x) > view.xRange || Math.abs(vector.y) > view.yRange ||
        Math.abs(output.x) > view.xRange || Math.abs(output.y) > view.yRange;
    });
    document.getElementById('overflow-note').hidden = !outside;
  };
  store.subscribe(updateRange);
  plot.canvas.addEventListener('viewportchange', updateRange);
  const applyRange = () => {
    try {
      const number = parseScalar(range.value);
      if (number < MIN_RANGE || number > MAX_RANGE) throw new Error('坐标范围必须在 0.5 至 1000 之间');
      range.setAttribute('aria-invalid', 'false');
      store.mutate({ type: 'view', range: number });
    } catch (problem) {
      range.setAttribute('aria-invalid', 'true');
      store.report(problem.message);
    }
  };
  range.addEventListener('change', applyRange);
  range.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') range.blur();
    if (event.key === 'Escape') {
      range.value = String(store.state.view.range);
      range.setAttribute('aria-invalid', 'false');
      range.blur();
    }
  });
  rangeMinus.addEventListener('click', () => store.mutate({ type: 'view', range: Math.max(MIN_RANGE, Math.round((store.state.view.range - 0.5) * 10000) / 10000) }));
  rangePlus.addEventListener('click', () => store.mutate({ type: 'view', range: Math.min(MAX_RANGE, Math.round((store.state.view.range + 0.5) * 10000) / 10000) }));
  document.querySelectorAll('[data-clear-trails]').forEach((button) => button.addEventListener('click', () => store.mutate({ type: 'clearTrails', token: uid() })));
  window.addEventListener('beforeunload', (event) => {
    if (store.queue.length || store.inflight) { event.preventDefault(); event.returnValue = ''; }
  });
}
