import test from 'node:test';
import assert from 'node:assert/strict';
import { Plot } from '../public/js/plot.mjs';
import { defaultState } from '../shared/model.mjs';
import { arrowTriangle, matrixGeometry, toScreen } from '../shared/geometry.mjs';

function fixture(matrix, vectors = []) {
  const calls = [];
  const fills = [];
  let path = [];
  const context = {};
  for (const method of ['save', 'restore', 'setTransform', 'clearRect', 'fillRect', 'strokeRect', 'rect', 'clip', 'setLineDash', 'stroke', 'arc', 'strokeText']) {
    context[method] = (...args) => { calls.push([method, ...args]); };
  }
  context.beginPath = () => { path = []; };
  context.moveTo = (x, y) => { path.push({ x, y }); };
  context.lineTo = (x, y) => { path.push({ x, y }); };
  context.closePath = () => {};
  context.fill = () => { fills.push({ points: [...path], color: context.fillStyle }); };
  context.fillText = (text, x, y) => { calls.push(['fillText', text, x, y]); };
  context.measureText = (text) => ({ width: text.length * 7 });
  const state = defaultState();
  state.matrix = matrix;
  state.vectors = vectors;
  const canvas = {
    style: {},
    setAttribute(name, value) { calls.push(['attribute', name, value]); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    setPointerCapture(id) { calls.push(['capture', id]); },
  };
  const plot = Object.assign(Object.create(Plot.prototype), {
    state, context, canvas, width: 1200, height: 800, ratio: 1,
    histories: new Map(), selectedId: vectors[0]?.id || null, drag: null,
    store: { ready: true },
  });
  return { plot, calls, fills };
}
const centroid = (triangle) => ({
  x: triangle.reduce((sum, point) => sum + point.x / 3, 0),
  y: triangle.reduce((sum, point) => sum + point.y / 3, 0),
});

test('renders the matrix region and both matrix arrows even with no input vectors', () => {
  const { plot, calls, fills } = fixture([[2, 3], [1, 4]]);
  plot.draw();
  const region = fills.find((fill) => fill.color === '#5b9f7b');
  assert.ok(region);
  assert.deepEqual(region.points, matrixGeometry(plot.state.matrix).parallelogram.map((point) => toScreen(point, plot.view)));
  assert.equal(fills.filter((fill) => fill.points.length === 3).length, 2);
  assert.ok(calls.some((call) => call[0] === 'setLineDash' && call[1][0] === 5));
  assert.deepEqual(calls.filter((call) => call[0] === 'fillText' && call[1].startsWith('Ae')).map((call) => call[1]), ['Ae₁', 'Ae₂']);
});

test('zero and singular matrices render finite regions without invented zero-vector directions', () => {
  for (const matrix of [[[0, 0], [0, 0]], [[1, 2], [2, 4]], [[-2, 1], [1, 3]], [[0.000001, 0], [0, 0.000001]]]) {
    const { plot, calls, fills } = fixture(matrix);
    plot.draw();
    assert.ok(fills.every((fill) => fill.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))));
    assert.ok(calls.every((call) => call.slice(1).every((value) => typeof value !== 'number' || Number.isFinite(value))));
    if (matrix[0][0] === 0) {
      assert.equal(fills.filter((fill) => fill.points.length === 3).length, 0);
      assert.ok(calls.some((call) => call[0] === 'fillText' && call[1] === 'Ae₁ = 0'));
      assert.ok(calls.some((call) => call[0] === 'fillText' && call[1] === 'Ae₂ = 0'));
    } else {
      assert.ok(!calls.some((call) => call[0] === 'fillText' && String(call[1]).includes(' = 0')));
    }
  }
});

test('matrix arrowheads do not start a drag; input arrowheads still do', () => {
  const input = { id: 'v1', number: 1, x: -2, y: -2 };
  const { plot, calls } = fixture([[3, 1], [1, 2]], [input]);
  const origin = toScreen({ x: 0, y: 0 }, plot.view);
  for (const vector of matrixGeometry(plot.state.matrix).basis) {
    const point = centroid(arrowTriangle(origin, toScreen(vector, plot.view), 12, 5.5));
    plot.down({ button: 0, pointerId: 1, clientX: point.x, clientY: point.y, preventDefault() { throw new Error('Matrix arrow captured input'); } });
    assert.equal(plot.drag, null);
  }
  const point = centroid(arrowTriangle(origin, toScreen(input, plot.view)));
  plot.down({ button: 0, pointerId: 2, clientX: point.x, clientY: point.y, preventDefault() {} });
  assert.equal(plot.drag.id, input.id);
  assert.ok(calls.some((call) => call[0] === 'capture' && call[1] === 2));
});
