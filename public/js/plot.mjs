import { colors, format, transform } from '../../shared/model.mjs';
import { arrowTriangle, dragPoint, gridStep, hitInputArrow, insidePlot, matrixGeometry, toScreen, viewport } from '../../shared/geometry.mjs';

const name = (vector, output = false) => (output ? 'Av' : 'v') + String(vector.number).replace(/\d/g, (digit) => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]);
export class Plot {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.store = store;
    this.state = store.state;
    this.histories = new Map();
    this.selectedId = this.state.vectors[0]?.id || null;
    this.frame = null;
    this.drag = null;
    this.width = 1; this.height = 1;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    store.subscribe((state) => this.update(state));
    canvas.addEventListener('pointerdown', (event) => this.down(event));
    canvas.addEventListener('pointermove', (event) => this.move(event));
    canvas.addEventListener('pointerup', (event) => this.up(event));
    canvas.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('lostpointercapture', () => this.cancel());
    canvas.addEventListener('pointerleave', () => { if (!this.drag) canvas.style.cursor = 'default'; });
  }
  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.canvas.dispatchEvent(new CustomEvent('vectorselect', { detail: id }));
    this.requestDraw();
  }
  update(state) {
    const key = (this.store.ready ? 'ready:' : 'loading:') + JSON.stringify(state.matrix) + ':' + state.trailToken;
    if (key !== this.trailKey) { this.histories.clear(); this.trailKey = key; }
    const active = new Set(state.vectors.map((vector) => vector.id));
    for (const id of this.histories.keys()) if (!active.has(id)) this.histories.delete(id);
    for (const vector of state.vectors) {
      let points = this.histories.get(vector.id);
      if (!points) { points = []; this.histories.set(vector.id, points); }
      const output = transform(state.matrix, vector);
      const previous = points.at(-1);
      if (!previous || Math.hypot(output.x - previous.x, output.y - previous.y) > 0.00001) {
        points.push(output);
        if (points.length > 480) points.splice(0, points.length - 480);
      }
    }
    this.state = state;
    if (!active.has(this.selectedId)) this.select(state.vectors[0]?.id || null);
    if (this.drag && !active.has(this.drag.id)) this.cancel();
    this.requestDraw();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ratio = ratio;
    this.canvas.dispatchEvent(new CustomEvent('viewportchange'));
    this.requestDraw();
  }
  get view() { return viewport(this.width, this.height, this.state.view.range); }
  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  down(event) {
    if (event.button !== 0 || !this.store.ready || this.drag) return;
    const point = this.point(event);
    const vector = hitInputArrow(point, this.state.vectors, this.view, this.selectedId);
    if (!vector) return;
    event.preventDefault();
    this.select(vector.id);
    const tip = toScreen(vector, this.view);
    this.drag = { id: vector.id, pointerId: event.pointerId, offset: { x: tip.x - point.x, y: tip.y - point.y } };
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = 'grabbing';
  }
  move(event) {
    const point = this.point(event);
    if (this.drag) {
      if (event.pointerId !== this.drag.pointerId) return;
      event.preventDefault();
      const next = dragPoint(point, this.drag.offset, this.view);
      const previous = this.state.vectors.find((vector) => vector.id === this.drag.id);
      if (previous && (previous.x !== next.x || previous.y !== next.y)) this.store.mutate({ type: 'vector', id: this.drag.id, ...next });
      return;
    }
    this.canvas.style.cursor = this.store.ready && hitInputArrow(point, this.state.vectors, this.view, this.selectedId) ? 'grab' : 'default';
  }
  up(event) {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    this.move(event);
    this.cancel();
  }
  cancel() {
    const pointerId = this.drag?.pointerId;
    this.drag = null;
    this.canvas.style.cursor = 'default';
    if (pointerId !== undefined && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
  }
  requestDraw() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); });
  }
  drawGrid(context, view) {
    context.fillStyle = '#ffffff';
    context.fillRect(view.left, view.top, view.plotWidth, view.plotHeight);
    const step = gridStep(view.range);
    const xCount = Math.floor(view.xRange / step + 0.00001);
    const yCount = Math.floor(view.yRange / step + 0.00001);
    context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    for (let index = -xCount; index <= xCount; index++) {
      const value = index * step;
      if (Math.abs(value) < 0.000001) continue;
      const position = toScreen({ x: value, y: value }, view);
      if (this.state.view.showGrid) {
        context.beginPath(); context.strokeStyle = '#edf0f4'; context.lineWidth = 1;
        context.moveTo(position.x, view.top); context.lineTo(position.x, view.bottom); context.stroke();
      }
      context.fillStyle = '#9aa2b2';
      context.fillText(format(value), position.x, view.cy + 18);
    }
    for (let index = -yCount; index <= yCount; index++) {
      const value = index * step;
      if (Math.abs(value) < 0.000001) continue;
      const position = toScreen({ x: 0, y: value }, view);
      if (this.state.view.showGrid) {
        context.beginPath(); context.strokeStyle = '#edf0f4'; context.lineWidth = 1;
        context.moveTo(view.left, position.y); context.lineTo(view.right, position.y); context.stroke();
      }
      context.fillStyle = '#9aa2b2'; context.textAlign = 'right';
      context.fillText(format(value), view.cx - 12, position.y);
    }
    context.textAlign = 'center';
    context.beginPath(); context.strokeStyle = '#b8c0cf'; context.lineWidth = 1.15;
    context.moveTo(view.left, view.cy); context.lineTo(view.right + 9, view.cy);
    context.moveTo(view.cx, view.bottom); context.lineTo(view.cx, view.top - 9); context.stroke();
    context.beginPath();
    context.moveTo(view.right + 9, view.cy); context.lineTo(view.right + 3, view.cy - 3); context.lineTo(view.right + 3, view.cy + 3);
    context.moveTo(view.cx, view.top - 9); context.lineTo(view.cx - 3, view.top - 3); context.lineTo(view.cx + 3, view.top - 3);
    context.fillStyle = '#a3adbf'; context.fill();
    context.fillStyle = '#7e889a';
    context.font = 'italic 13px Georgia, serif';
    context.fillText('x', view.right + 23, view.cy);
    context.fillText('y', view.cx, view.top - 24);
    context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.fillText('0', view.cx - 12, view.cy + 17);
    context.strokeStyle = '#e7ebf1'; context.lineWidth = 1;
    context.strokeRect(view.left, view.top, view.plotWidth, view.plotHeight);
  }
  drawMatrixFrame(context, view) {
    const geometry = matrixGeometry(this.state.matrix);
    const origin = toScreen({ x: 0, y: 0 }, view);
    const polygon = (points) => {
      context.beginPath();
      points.forEach((point, index) => {
        const pixel = toScreen(point, view);
        if (index === 0) context.moveTo(pixel.x, pixel.y);
        else context.lineTo(pixel.x, pixel.y);
      });
      context.closePath();
    };
    context.save();
    // The dashed unit square is a fixed reference, independent of input vectors.
    polygon(geometry.unitSquare);
    context.strokeStyle = '#91a8b5'; context.lineWidth = 1.6;
    context.globalAlpha = 0.65; context.setLineDash([5, 5]); context.stroke();

    polygon(geometry.parallelogram);
    context.setLineDash([]); context.globalAlpha = 0.13;
    context.fillStyle = '#5b9f7b'; context.fill();
    context.globalAlpha = 0.65; context.strokeStyle = '#5b9f7b';
    context.lineWidth = 1.8; context.stroke();
    context.globalAlpha = 1;

    geometry.basis.forEach((vector, index) => {
      const tip = toScreen(vector, view);
      const color = index === 0 ? '#5a9d75' : '#3e8d79';
      const pixelLength = Math.hypot(tip.x - origin.x, tip.y - origin.y);
      const zero = vector.x === 0 && vector.y === 0;
      context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 2.6;
      if (!zero) {
        context.beginPath(); context.moveTo(origin.x, origin.y); context.lineTo(tip.x, tip.y); context.stroke();
        const headLength = Math.min(12, pixelLength * 0.7);
        const triangle = arrowTriangle(origin, tip, headLength, headLength * 5.5 / 12);
        context.beginPath(); context.moveTo(triangle[0].x, triangle[0].y);
        context.lineTo(triangle[1].x, triangle[1].y); context.lineTo(triangle[2].x, triangle[2].y);
        context.closePath(); context.fill();
      }
      if (insidePlot(tip, view)) {
        const text = (index === 0 ? 'Ae₁' : 'Ae₂') + (zero ? ' = 0' : '');
        context.font = '600 12px system-ui, sans-serif';
        context.textAlign = 'left'; context.textBaseline = 'middle';
        const x = Math.min(view.right - context.measureText(text).width - 5, Math.max(view.left + 5, tip.x + 11));
        const y = Math.min(view.bottom - 10, Math.max(view.top + 10, tip.y + (index === 0 ? -17 : 18)));
        context.strokeStyle = '#fff'; context.lineWidth = 4; context.lineJoin = 'round';
        context.strokeText(text, x, y); context.fillStyle = color; context.fillText(text, x, y);
      }
    });
    context.restore();
  }
  drawArrow(context, vector, output, view) {
    const value = output ? transform(this.state.matrix, vector) : vector;
    const origin = toScreen({ x: 0, y: 0 }, view);
    const tip = toScreen(value, view);
    const triangle = arrowTriangle(origin, tip);
    const palette = colors(vector);
    const color = output ? palette.output : palette.input;
    context.strokeStyle = color; context.fillStyle = color;
    context.lineWidth = output ? 2.2 : vector.id === this.selectedId ? 2.8 : 2.1;
    context.setLineDash(output ? [6, 5] : []);
    context.beginPath(); context.moveTo(origin.x, origin.y); context.lineTo(tip.x, tip.y); context.stroke();
    context.setLineDash([]);
    context.beginPath(); context.moveTo(triangle[0].x, triangle[0].y);
    context.lineTo(triangle[1].x, triangle[1].y); context.lineTo(triangle[2].x, triangle[2].y); context.closePath();
    if (output) { context.fillStyle = '#fff'; context.fill(); context.stroke(); }
    else { context.fill(); }
    if (insidePlot(tip, view)) {
      const text = name(vector, output);
      context.font = '600 13px system-ui, sans-serif';
      context.textAlign = 'left'; context.textBaseline = 'middle';
      const labelX = Math.min(view.right - context.measureText(text).width - 5, Math.max(view.left + 5, tip.x + 12));
      const labelY = Math.min(view.bottom - 10, Math.max(view.top + 10, tip.y + (output ? 17 : -15)));
      context.strokeStyle = '#fff'; context.lineWidth = 5; context.lineJoin = 'round';
      context.strokeText(text, labelX, labelY);
      context.fillStyle = color; context.fillText(text, labelX, labelY);
    }
  }
  draw() {
    const context = this.context;
    const view = this.view;
    context.setTransform(this.ratio || 1, 0, 0, this.ratio || 1, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    this.drawGrid(context, view);
    context.save();
    context.beginPath(); context.rect(view.left, view.top, view.plotWidth, view.plotHeight); context.clip();
    this.drawMatrixFrame(context, view);
    if (this.state.view.showTrails) {
      for (const vector of this.state.vectors) {
        const points = this.histories.get(vector.id) || [];
        if (points.length < 2) continue;
        context.beginPath();
        points.forEach((point, index) => {
          const pixel = toScreen(point, view);
          if (index === 0) context.moveTo(pixel.x, pixel.y);
          else context.lineTo(pixel.x, pixel.y);
        });
        context.strokeStyle = colors(vector).output; context.lineWidth = 2;
        context.globalAlpha = 0.4; context.setLineDash([]); context.stroke(); context.globalAlpha = 1;
      }
    }
    for (const vector of this.state.vectors) this.drawArrow(context, vector, true, view);
    for (const vector of this.state.vectors) this.drawArrow(context, vector, false, view);
    context.beginPath(); context.arc(view.cx, view.cy, 3, 0, Math.PI * 2);
    context.fillStyle = '#7f899b'; context.fill();
    context.restore();
    this.canvas.setAttribute('aria-label', '二维坐标系，x 轴正负 ' + format(view.xRange) + '，y 轴正负 ' + format(view.yRange) + '，共 ' + this.state.vectors.length + ' 个输入向量。绿色 Ae₁、Ae₂ 表示矩阵的两列，绿色区域是变换后的单位正方形。仅输入向量箭头可拖动。');
  }
}
