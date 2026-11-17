import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowTriangle, dragPoint, gridStep, hitInputArrow, pointInTriangle, toScreen, toWorld, viewport } from '../shared/geometry.mjs';

test('coordinates preserve equal x/y units and convert in both directions', () => {
  const view = viewport(1200, 800, 6);
  const point = { x: 2.25, y: -3.5 };
  const restored = toWorld(toScreen(point, view), view);
  assert.ok(Math.abs(restored.x - point.x) < 1e-12);
  assert.ok(Math.abs(restored.y - point.y) < 1e-12);
  assert.ok(Math.abs((toScreen({ x: 1, y: 0 }, view).x - view.cx) - (view.cy - toScreen({ x: 0, y: 1 }, view).y)) < 1e-10);
});
test('wide canvases expose the unused horizontal space without stretching units', () => {
  const view = viewport(1200, 800, 6);
  assert.equal(view.left, 44);
  assert.equal(view.right, 1156);
  assert.equal(view.plotWidth, 1112);
  assert.equal(view.plotHeight, 712);
  assert.equal(view.yRange, 6);
  assert.ok(view.xRange > 9);
  assert.equal(view.range, 6);
  const vector = { id: 'expanded', x: 9, y: 2 };
  const triangle = arrowTriangle(toScreen({ x: 0, y: 0 }, view), toScreen(vector, view));
  const center = { x: triangle.reduce((sum, p) => sum + p.x / 3, 0), y: triangle.reduce((sum, p) => sum + p.y / 3, 0) };
  assert.equal(hitInputArrow(center, [vector], view)?.id, vector.id);
  assert.deepEqual(dragPoint(toScreen(vector, view), { x: 0, y: 0 }, view), { x: 9, y: 2 });
});
test('portrait canvases extend the y axis while keeping the manual x range', () => {
  const view = viewport(700, 1000, 6);
  assert.equal(view.xRange, 6);
  assert.ok(view.yRange > 8);
  assert.deepEqual(dragPoint(toScreen({ x: 2, y: 8 }, view), { x: 0, y: 0 }, view), { x: 2, y: 8 });
});
test('drag limits follow each visible axis in a rectangular plot', () => {
  const view = viewport(1200, 800, 6);
  const dragged = dragPoint({ x: 10000, y: -10000 }, { x: 0, y: 0 }, view);
  assert.equal(dragged.x, view.xRange);
  assert.equal(dragged.y, 6);
  assert.equal(view.range, 6);
});
test('only the actual input arrow triangle is draggable, not its shaft or background', () => {
  const view = viewport(800, 800, 6);
  const vector = { id: 'v1', x: 3, y: 0 };
  const origin = toScreen({ x: 0, y: 0 }, view);
  const tip = toScreen(vector, view);
  assert.equal(hitInputArrow({ x: tip.x - 6, y: tip.y }, [vector], view)?.id, 'v1');
  assert.equal(hitInputArrow({ x: (origin.x + tip.x) / 2, y: origin.y }, [vector], view), null);
  assert.equal(hitInputArrow(origin, [vector], view), null);
  assert.equal(hitInputArrow({ x: tip.x - 8, y: tip.y + 11 }, [vector], view), null);
  assert.equal(hitInputArrow(toScreen({ x: 4, y: 2 }, view), [vector], view), null);
});
test('diagonal and negative vectors use the drawn arrow geometry', () => {
  const view = viewport(900, 700, 6);
  const vector = { id: 'negative', x: -2, y: 3 };
  const triangle = arrowTriangle(toScreen({ x: 0, y: 0 }, view), toScreen(vector, view));
  const center = { x: triangle.reduce((sum, p) => sum + p.x / 3, 0), y: triangle.reduce((sum, p) => sum + p.y / 3, 0) };
  assert.ok(pointInTriangle(center, triangle));
  assert.equal(hitInputArrow(center, [vector], view)?.id, vector.id);
});
test('a zero vector still has a visible, draggable arrowhead', () => {
  const view = viewport(700, 700, 6);
  const zero = { id: 'zero', x: 0, y: 0 };
  assert.equal(hitInputArrow({ x: view.cx - 7, y: view.cy }, [zero], view)?.id, zero.id);
  assert.equal(hitInputArrow({ x: view.cx + 7, y: view.cy }, [zero], view), null);
});
test('selected vector wins when arrowheads overlap', () => {
  const view = viewport(700, 700, 6);
  const vectors = [{ id: 'a', x: 2, y: 1 }, { id: 'b', x: 2, y: 1 }];
  const triangle = arrowTriangle(toScreen({ x: 0, y: 0 }, view), toScreen(vectors[0], view));
  const center = { x: triangle.reduce((sum, p) => sum + p.x / 3, 0), y: triangle.reduce((sum, p) => sum + p.y / 3, 0) };
  assert.equal(hitInputArrow(center, vectors, view, 'a')?.id, 'a');
  assert.equal(hitInputArrow(center, vectors, view, 'b')?.id, 'b');
});
test('dragging preserves pointer-to-tip offset and clamps to the fixed plot', () => {
  const view = viewport(800, 800, 6);
  const tip = toScreen({ x: 2, y: 1 }, view);
  assert.deepEqual(dragPoint({ x: tip.x - 5, y: tip.y + 2 }, { x: 5, y: -2 }, view), { x: 2, y: 1 });
  assert.deepEqual(dragPoint({ x: 10000, y: -10000 }, { x: 0, y: 0 }, view), { x: 6, y: 6 });
  assert.equal(view.range, 6);
});
test('grid has a bounded number of ticks across the allowed manual ranges', () => {
  for (const range of [.5, 1, 6, 20, 100, 1000]) {
    const step = gridStep(range);
    assert.ok(step > 0);
    assert.ok(2 * range / step <= 12.001);
  }
});
