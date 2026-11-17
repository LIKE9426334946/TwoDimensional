import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

async function close(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await closed;
}
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'twodimensional-'));
  let app;
  const start = async () => {
    app = await createApp({ dataDir });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    return 'http://127.0.0.1:' + app.server.address().port;
  };
  t.after(async () => { if (app) await close(app.server); await rm(dataDir, { recursive: true, force: true }); });
  let url = await start();
  return { dataDir, get url() { return url; }, restart: async () => { await close(app.server); url = await start(); } };
}
async function patch(fixture, operations, clientId = 'test_client', seq = 1) {
  const response = await fetch(fixture.url + '/api/state', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, seq, operations }),
  });
  return { status: response.status, payload: await response.json() };
}
test('serves display/admin/assets and keeps data files out of the public routes', async (t) => {
  const app = await fixture(t);
  for (const route of ['/', '/admin', '/admin/', '/assets/app.css', '/assets/icon.svg', '/js/plot.mjs', '/shared/model.mjs']) {
    const response = await fetch(app.url + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 20);
  }
  assert.deepEqual(await (await fetch(app.url + '/api/health')).json(), { ok: true, project: 'TwoDimensional' });
  assert.equal((await fetch(app.url + '/data/state.json')).status, 404);
  assert.equal((await fetch(app.url + '/server.mjs')).status, 404);
  assert.equal((await fetch(app.url + '/api/events?client=bad%20id')).status, 400);
});
test('commits atomically, deduplicates retries, rejects invalid transactions and survives restart', async (t) => {
  const app = await fixture(t);
  const updated = await patch(app, [{ type: 'matrix', row: 0, col: 0, value: 3 }]);
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.state.revision, 1);
  const duplicate = await patch(app, [{ type: 'matrix', row: 0, col: 0, value: 999 }]);
  assert.equal(duplicate.payload.state.revision, 1);
  assert.equal(duplicate.payload.state.matrix[0][0], 3);
  const rejected = await patch(app, [{ type: 'vector', id: 'v1', x: 7 }, { type: 'view', range: -1 }], 'another', 1);
  assert.equal(rejected.status, 400);
  const saved = JSON.parse(await readFile(path.join(app.dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.vectors[0].x, 2);
  assert.equal(saved.revision, 1);
  await app.restart();
  const restored = (await (await fetch(app.url + '/api/state')).json()).state;
  assert.deepEqual(restored, saved);
});
test('concurrent field-level changes preserve both editors and never auto-fit the axes', async (t) => {
  const app = await fixture(t);
  const results = await Promise.all([
    patch(app, [{ type: 'matrix', row: 0, col: 0, value: 1000 }], 'matrix_editor'),
    patch(app, [{ type: 'vector', id: 'v1', x: -5, y: 0 }], 'drag_editor'),
  ]);
  assert.ok(results.every((result) => result.status === 200));
  const { state } = await (await fetch(app.url + '/api/state')).json();
  assert.equal(state.revision, 2);
  assert.equal(state.matrix[0][0], 1000);
  assert.equal(state.vectors[0].x, -5);
  assert.equal(state.vectors[0].y, 0);
  assert.equal(state.view.range, 6);
});
test('SSE sends initial and updated state with client acknowledgements', { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const response = await fetch(app.url + '/api/events?client=observer');
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  async function nextState() {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event.split('\n').find((line) => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('Unexpected end of event stream');
      buffer += decoder.decode(value, { stream: true });
    }
  }
  try {
    assert.equal((await nextState()).state.vectors.length, 1);
    const result = await patch(app, [{ type: 'addVector', id: 'second', x: -1, y: 2 }], 'observer');
    const event = await nextState();
    assert.equal(event.ackSeq, 1);
    assert.deepEqual(event.state, result.payload.state);
    assert.equal(event.state.vectors.length, 2);
  } finally { await reader.cancel(); }
});
test('corrupt saved data is reported without silently overwriting it', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'twodimensional-corrupt-'));
  try {
    const statePath = path.join(dataDir, 'state.json');
    await writeFile(statePath, '{broken');
    await assert.rejects(() => createApp({ dataDir }), /原数据未被覆盖/);
    assert.equal(await readFile(statePath, 'utf8'), '{broken');
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
