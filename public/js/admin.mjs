import { colors, format, MAX_VECTORS, parseScalar, transform } from '/shared/model.mjs';
import { bindCommon, Store, uid, vectorName } from './client.mjs';
import { Plot } from './plot.mjs';

const store = new Store();
const canvas = document.getElementById('plot');
const plot = new Plot(canvas, store);
const cards = new Map();
const list = document.getElementById('vector-editor');
const addButton = document.getElementById('add-vector');
const matrixInputs = [...document.querySelectorAll('input[data-coef]')];
function numericInput(input, currentValue, commit) {
  input.addEventListener('input', () => {
    try {
      const value = parseScalar(input.value);
      input.setAttribute('aria-invalid', String(!commit(value)));
    } catch { input.setAttribute('aria-invalid', 'true'); }
  });
  input.addEventListener('blur', () => {
    if (input.getAttribute('aria-invalid') === 'true') {
      store.report('标红的数值尚未应用，请输入有效数字或分数');
    } else { input.value = String(currentValue()); }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      input.value = String(currentValue());
      input.setAttribute('aria-invalid', 'false');
      input.blur();
    }
  });
}
function syncInput(input, value) {
  if (document.activeElement !== input && input.getAttribute('aria-invalid') !== 'true') input.value = String(value);
  input.disabled = !store.ready;
}
matrixInputs.forEach((input) => {
  const [row, col] = input.dataset.coef.split(',').map(Number);
  numericInput(input, () => store.state.matrix[row][col], (value) => store.mutate({ type: 'matrix', row, col, value }));
});
const presets = {
  identity: [[1, 0], [0, 1]], rotation: [[0, -1], [1, 0]],
  scale: [[2, 0], [0, 2]], shear: [[1, 0.5], [0, 1]],
};
document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => {
    matrixInputs.forEach((input) => input.setAttribute('aria-invalid', 'false'));
    const matrix = presets[button.dataset.preset];
    store.mutate(matrix.flatMap((row, rowIndex) => row.map((value, col) => ({ type: 'matrix', row: rowIndex, col, value }))));
  });
});
function render(state) {
  for (const input of matrixInputs) {
    const [row, col] = input.dataset.coef.split(',').map(Number);
    syncInput(input, state.matrix[row][col]);
  }
  document.getElementById('vector-count').textContent = String(state.vectors.length);
  addButton.disabled = !store.ready || state.vectors.length >= MAX_VECTORS;
  const active = new Set(state.vectors.map((vector) => vector.id));
  for (const [id, card] of cards) if (!active.has(id)) { card.remove(); cards.delete(id); }
  for (const vector of state.vectors) {
    let card = cards.get(vector.id);
    if (!card) {
      card = document.createElement('div');
      card.className = 'vector-card';
      card.dataset.vectorId = vector.id;
      card.innerHTML = '<div class="vector-card-head"><i class="dot"></i><strong></strong><button class="delete-vector" type="button">×</button></div><div class="xy-fields"><label class="xy-field"><span>x</span><input type="text" inputmode="decimal" autocomplete="off" data-coordinate="x"></label><label class="xy-field"><span>y</span><input type="text" inputmode="decimal" autocomplete="off" data-coordinate="y"></label></div><div class="vector-result"><i class="dash"></i><span class="result-name"></span><span class="result-value"></span></div>';
      card.querySelector('.delete-vector').addEventListener('click', () => store.mutate({ type: 'removeVector', id: vector.id }));
      card.addEventListener('pointerdown', () => plot.select(vector.id));
      for (const input of card.querySelectorAll('input')) {
        const coordinate = input.dataset.coordinate;
        numericInput(input,
          () => store.state.vectors.find((item) => item.id === vector.id)?.[coordinate] ?? 0,
          (value) => store.mutate({ type: 'vector', id: vector.id, [coordinate]: value }));
      }
      cards.set(vector.id, card);
      list.append(card);
    }
    const palette = colors(vector);
    card.style.setProperty('--input-color', palette.input);
    card.style.setProperty('--output-color', palette.output);
    card.dataset.selected = String(vector.id === plot.selectedId);
    card.querySelector('strong').textContent = vectorName(vector);
    const remove = card.querySelector('.delete-vector');
    remove.setAttribute('aria-label', '删除向量 ' + vectorName(vector));
    remove.disabled = !store.ready;
    card.querySelectorAll('input').forEach((input) => {
      input.setAttribute('aria-label', vectorName(vector) + ' 的 ' + input.dataset.coordinate + ' 坐标');
      syncInput(input, vector[input.dataset.coordinate]);
    });
    card.querySelector('.result-name').textContent = vectorName(vector, true);
    const output = transform(state.matrix, vector);
    card.querySelector('.result-value').textContent = '(' + format(output.x) + ', ' + format(output.y) + ')';
  }
  const showGrid = document.getElementById('show-grid');
  const showTrails = document.getElementById('show-trails');
  showGrid.checked = state.view.showGrid;
  showTrails.checked = state.view.showTrails;
  showGrid.disabled = !store.ready;
  showTrails.disabled = !store.ready;
  document.querySelectorAll('[data-preset],[data-clear-trails]').forEach((button) => { button.disabled = !store.ready; });
}
addButton.addEventListener('click', () => {
  const angle = store.state.nextVectorNumber * 2.399963;
  const radius = Math.min(3, store.state.view.range * 0.45);
  const id = 'v_' + uid();
  const x = Math.round(Math.cos(angle) * radius * 1000) / 1000;
  const y = Math.round(Math.sin(angle) * radius * 1000) / 1000;
  if (store.mutate({ type: 'addVector', id, x, y })) plot.select(id);
});
document.getElementById('show-grid').addEventListener('change', (event) => store.mutate({ type: 'view', showGrid: event.target.checked }));
document.getElementById('show-trails').addEventListener('change', (event) => store.mutate({ type: 'view', showTrails: event.target.checked }));
canvas.addEventListener('vectorselect', () => render(store.state));
store.subscribe(render);
bindCommon(store, plot);
store.start();
