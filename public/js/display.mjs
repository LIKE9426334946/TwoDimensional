import { colors, determinant, format, transform } from '/shared/model.mjs';
import { bindCommon, Store, vectorName } from './client.mjs';
import { Plot } from './plot.mjs';

const store = new Store();
const canvas = document.getElementById('plot');
const plot = new Plot(canvas, store);
const list = document.getElementById('vector-readout');
const cards = new Map();
function render(state) {
  document.querySelectorAll('[data-coef]').forEach((cell) => {
    const [row, col] = cell.dataset.coef.split(',').map(Number);
    cell.textContent = format(state.matrix[row][col]);
    cell.title = String(state.matrix[row][col]);
  });
  document.getElementById('det-value').textContent = format(determinant(state.matrix));
  document.getElementById('vector-count').textContent = String(state.vectors.length);
  document.getElementById('empty-state').hidden = state.vectors.length > 0;
  const active = new Set(state.vectors.map((vector) => vector.id));
  for (const [id, card] of cards) {
    if (!active.has(id)) { card.remove(); cards.delete(id); }
  }
  for (const vector of state.vectors) {
    let card = cards.get(vector.id);
    if (!card) {
      card = document.createElement('button');
      card.type = 'button';
      card.className = 'readout-vector';
      card.innerHTML = '<div class="value-line"><i class="line-key"></i><strong></strong><span></span></div><div class="value-line output-value"><i class="line-key"></i><strong></strong><span></span></div>';
      card.addEventListener('click', () => plot.select(vector.id));
      list.append(card);
      cards.set(vector.id, card);
    }
    const palette = colors(vector);
    card.style.setProperty('--input-color', palette.input);
    card.style.setProperty('--output-color', palette.output);
    card.dataset.selected = String(vector.id === plot.selectedId);
    card.setAttribute('aria-pressed', String(vector.id === plot.selectedId));
    card.setAttribute('aria-label', '选择输入向量 ' + vectorName(vector));
    const rows = card.querySelectorAll('.value-line');
    rows[0].querySelector('strong').textContent = vectorName(vector);
    rows[0].querySelector('span').textContent = '(' + format(vector.x) + ', ' + format(vector.y) + ')';
    rows[1].querySelector('strong').textContent = vectorName(vector, true);
    const output = transform(state.matrix, vector);
    rows[1].querySelector('span').textContent = '(' + format(output.x) + ', ' + format(output.y) + ')';
  }
}
canvas.addEventListener('vectorselect', () => render(store.state));
store.subscribe(render);
bindCommon(store, plot);
store.start();
