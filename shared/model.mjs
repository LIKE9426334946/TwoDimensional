export const MAX_VECTORS = 24;
export const MIN_RANGE = 0.5;
export const MAX_RANGE = 1000;
export const MAX_VALUE = 1000000;
export const PALETTE = [
  { input: '#5265dd', output: '#cb8740' },
  { input: '#9360c5', output: '#168b7d' },
  { input: '#c45572', output: '#388bb1' },
  { input: '#4f8c55', output: '#bc733e' },
  { input: '#4a85b9', output: '#b35ba6' },
  { input: '#818139', output: '#ba5b4c' },
];
export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}
const fail = (message) => { throw new ValidationError(message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const valueNumber = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_VALUE) {
    fail('数值必须是有限数字，且绝对值不超过 1000000');
  }
  return Object.is(value, -0) ? 0 : value;
};
export function parseScalar(text) {
  const source = String(text).trim();
  if (!source) throw new ValidationError('请输入数字');
  const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  const parts = source.split('/').map((part) => part.trim());
  if (parts.length > 2 || parts.some((part) => !decimal.test(part))) {
    throw new ValidationError('请输入整数、小数或分数，例如 1/2');
  }
  const denominator = parts.length === 2 ? Number(parts[1]) : 1;
  if (!Number.isFinite(denominator) || denominator === 0) throw new ValidationError('分母必须是非零有限数字');
  return valueNumber(Number(parts[0]) / denominator);
}
export function transform(matrix, vector) {
  return {
    x: matrix[0][0] * vector.x + matrix[0][1] * vector.y,
    y: matrix[1][0] * vector.x + matrix[1][1] * vector.y,
  };
}
export function determinant(matrix) { return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]; }
export function colors(vector) { return PALETTE[(vector.number - 1) % PALETTE.length]; }
export function format(value, precision = 3) {
  const normalized = Math.abs(value) < 0.5 * 10 ** -precision ? 0 : value;
  return Number(normalized.toFixed(precision)).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: precision });
}
export function defaultState() {
  return {
    schemaVersion: 1, revision: 0, updatedAt: null, nextVectorNumber: 2,
    matrix: [[1, 0.5], [0, 1]],
    vectors: [{ id: 'v1', number: 1, x: 2, y: 2 }],
    view: { range: 6, showGrid: true, showTrails: true },
    trailToken: 'initial',
  };
}
export function validateState(state) {
  if (!isObject(state) || state.schemaVersion !== 1) fail('不支持的数据格式');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) fail('无效的版本号');
  if (!Number.isSafeInteger(state.nextVectorNumber) || state.nextVectorNumber < 1) fail('无效的向量编号');
  if (!Array.isArray(state.matrix) || state.matrix.length !== 2 ||
      state.matrix.some((row) => !Array.isArray(row) || row.length !== 2)) fail('矩阵必须为 2 × 2');
  state.matrix.flat().forEach(valueNumber);
  if (!Array.isArray(state.vectors) || state.vectors.length > MAX_VECTORS) fail('最多支持 24 个向量');
  const ids = new Set();
  const numbers = new Set();
  for (const vector of state.vectors) {
    if (!isObject(vector) || !validId(vector.id) || ids.has(vector.id) ||
        !Number.isSafeInteger(vector.number) || vector.number < 1 ||
        vector.number >= state.nextVectorNumber || numbers.has(vector.number)) fail('无效或重复的向量编号');
    ids.add(vector.id); numbers.add(vector.number);
    valueNumber(vector.x); valueNumber(vector.y);
  }
  if (!isObject(state.view) || !Number.isFinite(state.view.range) ||
      state.view.range < MIN_RANGE || state.view.range > MAX_RANGE ||
      typeof state.view.showGrid !== 'boolean' || typeof state.view.showTrails !== 'boolean') fail('无效的坐标系设置');
  if (!validId(state.trailToken)) fail('无效的轨迹标识');
  if (state.updatedAt !== null && (typeof state.updatedAt !== 'string' || !Number.isFinite(Date.parse(state.updatedAt)))) fail('无效的更新时间');
  return state;
}
export function applyOperations(state, operations) {
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 64) fail('每次需要 1 至 64 个操作');
  const next = {
    ...state, matrix: state.matrix.map((row) => [...row]),
    vectors: state.vectors.map((vector) => ({ ...vector })), view: { ...state.view },
  };
  for (const operation of operations) {
    if (!isObject(operation)) fail('无效的操作');
    switch (operation.type) {
      case 'matrix': {
        const { row, col } = operation;
        if (![0, 1].includes(row) || ![0, 1].includes(col)) fail('矩阵索引必须为 0 或 1');
        next.matrix[row][col] = valueNumber(operation.value);
        break;
      }
      case 'vector': {
        if (!validId(operation.id)) fail('无效的向量标识');
        const vector = next.vectors.find((item) => item.id === operation.id);
        if (!vector) fail('这个向量已被删除，请重新选择');
        if (!Object.hasOwn(operation, 'x') && !Object.hasOwn(operation, 'y')) fail('缺少向量坐标');
        if (Object.hasOwn(operation, 'x')) vector.x = valueNumber(operation.x);
        if (Object.hasOwn(operation, 'y')) vector.y = valueNumber(operation.y);
        break;
      }
      case 'addVector': {
        if (!validId(operation.id)) fail('无效的向量标识');
        if (next.vectors.some((item) => item.id === operation.id)) break;
        if (next.vectors.length >= MAX_VECTORS) fail('最多支持 24 个输入向量');
        next.vectors.push({
          id: operation.id, number: next.nextVectorNumber++,
          x: valueNumber(operation.x ?? 1), y: valueNumber(operation.y ?? 1),
        });
        break;
      }
      case 'removeVector':
        if (!validId(operation.id)) fail('无效的向量标识');
        next.vectors = next.vectors.filter((item) => item.id !== operation.id);
        break;
      case 'view': {
        const keys = Object.keys(operation).filter((key) => key !== 'type');
        if (!keys.length || keys.some((key) => !['range', 'showGrid', 'showTrails'].includes(key))) fail('未知的坐标系设置');
        for (const key of keys) {
          const value = operation[key];
          if (key === 'range') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_RANGE || value > MAX_RANGE) fail('坐标范围必须在 0.5 至 1000 之间');
          } else if (typeof value !== 'boolean') fail('显示设置必须为布尔值');
          next.view[key] = value;
        }
        break;
      }
      case 'clearTrails':
        if (!validId(operation.token)) fail('无效的轨迹标识');
        next.trailToken = operation.token;
        break;
      default: fail('未知的操作类型');
    }
  }
  return validateState(next);
}
export function coalesce(queue, operation) {
  const last = queue.at(-1);
  if (last && operation.type === 'vector' && last.type === 'vector' && last.id === operation.id) {
    queue[queue.length - 1] = { ...last, ...operation };
  } else if (last && operation.type === 'matrix' && last.type === 'matrix' && last.row === operation.row && last.col === operation.col) {
    queue[queue.length - 1] = operation;
  } else if (last && operation.type === 'view' && last.type === 'view') {
    queue[queue.length - 1] = { ...last, ...operation };
  } else { queue.push(operation); }
  return queue;
}
