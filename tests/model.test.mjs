import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, coalesce, defaultState, determinant, format, MAX_VECTORS, parseScalar, transform, validateState } from '../shared/model.mjs';

test('keyboard numbers support decimals, signed values, scientific notation and fractions without eval', () => {
  for (const [source, expected] of [['-2', -2], ['.25', .25], ['1/2', .5], [' -3 / 4 ', -.75], ['1e-3', .001], ['0', 0]]) assert.equal(parseScalar(source), expected);
  for (const source of ['', ' ', '-', '1/0', '1/2/3', 'NaN', 'Infinity', '1+2', '0x10', '1000001', '1e309', 'alert(1)']) assert.throws(() => parseScalar(source));
});
test('matrix multiplication uses column vectors and handles rotations and singular matrices', () => {
  assert.deepEqual(transform([[1, 0], [0, 1]], { x: 2, y: -3 }), { x: 2, y: -3 });
  assert.deepEqual(transform([[0, -1], [1, 0]], { x: 2, y: 1 }), { x: -1, y: 2 });
  assert.deepEqual(transform([[1, 2], [2, 4]], { x: -2, y: 1 }), { x: 0, y: 0 });
  assert.equal(determinant([[1, 2], [2, 4]]), 0);
  assert.equal(determinant([[0, -1], [1, 0]]), 1);
});
test('operations preserve unedited fields and never resize the coordinate range', () => {
  const before = defaultState();
  const after = applyOperations(before, [
    { type: 'matrix', row: 0, col: 0, value: 1000000 },
    { type: 'vector', id: 'v1', x: 1000000, y: 0 },
  ]);
  assert.equal(before.matrix[0][0], 1);
  assert.equal(before.vectors[0].x, 2);
  assert.equal(after.matrix[0][1], .5);
  assert.equal(after.vectors[0].y, 0);
  assert.deepEqual(after.view, before.view);
  assert.equal(transform(after.matrix, after.vectors[0]).x, 1000000000000);
});
test('a rejected multi-operation transaction leaves the original state intact', () => {
  const before = defaultState();
  assert.throws(() => applyOperations(before, [
    { type: 'vector', id: 'v1', x: 7 },
    { type: 'view', range: 0 },
  ]));
  assert.equal(before.vectors[0].x, 2);
  for (const operation of [
    { type: 'matrix', row: 2, col: 0, value: 1 },
    { type: 'matrix', row: 0, col: 0, value: null },
    { type: 'vector', id: 'missing', x: 1 },
    { type: 'vector', id: 'v1', y: Infinity },
    { type: 'view', range: 1001 },
    { type: 'view', showTrails: 'yes' },
    { type: 'view', unexpected: true },
    { type: 'addVector', id: '<script>' },
  ]) assert.throws(() => applyOperations(before, [operation]));
});
test('vectors can all be removed; numbering stays stable and never reuses a deleted number', () => {
  let state = applyOperations(defaultState(), [{ type: 'addVector', id: 'second', x: -1, y: 0 }]);
  state = applyOperations(state, [{ type: 'removeVector', id: 'v1' }, { type: 'removeVector', id: 'second' }]);
  assert.equal(state.vectors.length, 0);
  state = applyOperations(state, [{ type: 'addVector', id: 'third' }]);
  assert.equal(state.vectors[0].number, 3);
  assert.equal(state.nextVectorNumber, 4);
  assert.equal(state.view.range, 6);
});
test('retries of add, delete, and clear commands are idempotent', () => {
  const commands = [{ type: 'addVector', id: 'new' }, { type: 'removeVector', id: 'v1' }, { type: 'clearTrails', token: 'clear_1' }];
  const state = applyOperations(defaultState(), commands);
  assert.deepEqual(applyOperations(state, commands), state);
});
test('vector count is bounded without removing existing vectors', () => {
  let state = defaultState();
  for (let index = 1; index < MAX_VECTORS; index++) state = applyOperations(state, [{ type: 'addVector', id: 'item_' + index }]);
  assert.throws(() => applyOperations(state, [{ type: 'addVector', id: 'overflow' }]));
  assert.equal(state.vectors.length, MAX_VECTORS);
});
test('coalesced drag updates preserve both coordinates and operation boundaries', () => {
  const queue = [];
  coalesce(queue, { type: 'vector', id: 'v1', x: 3 });
  coalesce(queue, { type: 'vector', id: 'v1', y: 4 });
  coalesce(queue, { type: 'vector', id: 'v1', x: 5 });
  assert.deepEqual(queue, [{ type: 'vector', id: 'v1', x: 5, y: 4 }]);
  coalesce(queue, { type: 'removeVector', id: 'v1' });
  coalesce(queue, { type: 'addVector', id: 'v1', x: 0, y: 0 });
  assert.equal(queue.length, 3);
  coalesce(queue, { type: 'view', range: 8 });
  coalesce(queue, { type: 'view', showGrid: false });
  assert.deepEqual(queue.at(-1), { type: 'view', range: 8, showGrid: false });
});
test('persisted state validation rejects duplicate IDs, duplicate labels and malformed data', () => {
  assert.equal(validateState(defaultState()).schemaVersion, 1);
  const state = defaultState();
  state.vectors.push({ ...state.vectors[0] });
  assert.throws(() => validateState(state));
  for (const state of [null, {}, { ...defaultState(), matrix: [[1, 2]] }, { ...defaultState(), revision: -1 }]) assert.throws(() => validateState(state));
  assert.equal(format(-0.0000001), '0');
});
