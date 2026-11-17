// Geometry is shared by drawing, pointer hit testing, and automated checks.
export function viewport(width, height, range) {
  const plotWidth = Math.max(1, width - 88);
  const plotHeight = Math.max(1, height - 88);
  const left = (width - plotWidth) / 2;
  const top = (height - plotHeight) / 2;
  const scale = Math.min(plotWidth, plotHeight) / (2 * range);
  return {
    width, height, plotWidth, plotHeight, left, top,
    right: left + plotWidth, bottom: top + plotHeight,
    cx: width / 2, cy: height / 2, scale, range,
    xRange: plotWidth / (2 * scale), yRange: plotHeight / (2 * scale),
  };
}
export function toScreen(point, view) { return { x: view.cx + point.x * view.scale, y: view.cy - point.y * view.scale }; }
export function toWorld(point, view) { return { x: (point.x - view.cx) / view.scale, y: (view.cy - point.y) / view.scale }; }
export function insidePlot(point, view) {
  return point.x >= view.left && point.x <= view.right && point.y >= view.top && point.y <= view.bottom;
}
export function arrowTriangle(origin, tip, length = 14, halfWidth = 6) {
  const magnitude = Math.hypot(tip.x - origin.x, tip.y - origin.y);
  const ux = magnitude > 0.001 ? (tip.x - origin.x) / magnitude : 1;
  const uy = magnitude > 0.001 ? (tip.y - origin.y) / magnitude : 0;
  return [
    tip,
    { x: tip.x - ux * length - uy * halfWidth, y: tip.y - uy * length + ux * halfWidth },
    { x: tip.x - ux * length + uy * halfWidth, y: tip.y - uy * length - ux * halfWidth },
  ];
}
export function pointInTriangle(point, triangle) {
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const values = [cross(triangle[0], triangle[1], point), cross(triangle[1], triangle[2], point), cross(triangle[2], triangle[0], point)];
  return !(values.some((value) => value < -0.0001) && values.some((value) => value > 0.0001));
}
export function hitInputArrow(point, vectors, view, selectedId) {
  if (!insidePlot(point, view)) return null;
  const ordered = [...vectors].reverse();
  const selectedIndex = ordered.findIndex((vector) => vector.id === selectedId);
  if (selectedIndex > 0) ordered.unshift(ordered.splice(selectedIndex, 1)[0]);
  const origin = toScreen({ x: 0, y: 0 }, view);
  for (const vector of ordered) {
    const tip = toScreen(vector, view);
    if (pointInTriangle(point, arrowTriangle(origin, tip))) return vector;
  }
  return null;
}
export function dragPoint(pointer, offset, view) {
  const world = toWorld({ x: pointer.x + offset.x, y: pointer.y + offset.y }, view);
  const bounded = (value, limit) => Math.max(-limit, Math.min(limit, Math.round(value * 10000) / 10000));
  return { x: bounded(world.x, view.xRange), y: bounded(world.y, view.yRange) };
}
export function gridStep(range) {
  const raw = (2 * range) / 12;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}
