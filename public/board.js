// A board (advanced/writing/6): a canvas of cards, words and arrows, in a note and open large. The canvas is 1200 units wide and scales with
// the page; a card is moved with the mouse (or a finger) and its arrows follow; a card that points at a note, a person or a task shows it
// live, read from its row every time. The Board card and connector are in the design library.

import { el, icon, request, api } from './ui.js';
import { inkLayer, renderStrokes } from './ink.js';

const WIDTH = 1200;
const HEIGHT = 700;
const NS = 'http://www.w3.org/2000/svg';

// Where a line from the middle of one box to the middle of another leaves the first box and arrives at the second.
export function edgePoints(a, b) {
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const ca = centre(a);
  const cb = centre(b);
  const clip = (from, to, r) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return from;
    const scale = Math.min(dx === 0 ? Infinity : (r.w / 2) / Math.abs(dx), dy === 0 ? Infinity : (r.h / 2) / Math.abs(dy));
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  };
  return { from: clip(ca, cb, a), to: clip(cb, ca, b) };
}

const svgEl = (tag, attrs = {}) => { const node = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node; };

// A card's words: the live thing it points at, or its own words.
function cardBody(item) {
  if (item.live) {
    if (item.live.missing) return [el('span', { class: 'board-card-title' }, 'Removed page'), el('span', { class: 'board-card-kind' }, item.live.kind)];
    return [el('span', { class: 'board-card-kind' }, item.live.kind === 'person' ? 'Person' : item.live.kind === 'task' ? 'Task' : 'Note'),
      el('span', { class: 'board-card-title' }, item.live.title), ...(item.live.sub ? [el('span', { class: 'board-card-sub' }, item.live.sub)] : []), ...(item.text ? [el('span', { class: 'board-card-sub' }, item.text)] : [])];
  }
  return [el('span', { class: 'board-card-title' }, item.text)];
}

// One card or piece of text, as the board draws it. Used by the library too.
export function boardCard(item, { selected = false, onRemove = null } = {}) {
  const node = el('div', {
    class: `board-card is-${item.kind}${item.live ? ' is-live' : ''}${item.origin === 'assistant' ? ' is-assistant' : ''}${selected ? ' is-selected' : ''}`,
    'data-item': item.id, 'data-kind': item.kind, role: 'group', 'aria-label': item.kind === 'text' ? `Text: ${item.text}` : `Card: ${item.live?.title ?? item.text}`,
  }, ...cardBody(item), ...(item.origin === 'assistant' ? [el('span', { class: 'board-tag' }, 'Your assistant')] : []),
  ...(onRemove ? [el('button', { type: 'button', class: 'board-remove', 'aria-label': 'Take it off the board', onclick: (event) => { event.stopPropagation(); onRemove(); } }, icon('close'))] : []));
  node.style.left = `${item.x}px`;
  node.style.top = `${item.y}px`;
  node.style.width = `${item.w}px`;
  if (item.kind === 'card') node.style.minHeight = `${item.h}px`;
  return node;
}

// The pick-something form for a card that points at a note, a person or a task.
async function candidates(kind, text) {
  const q = text.trim();
  if (kind === 'task') {
    const tasks = await request('GET', '/api/tasks');
    return tasks.filter((t) => !q || t.text.toLowerCase().includes(q.toLowerCase())).slice(0, 8).map((t) => ({ ref_table: 'tasks', ref_id: t.id, label: t.text }));
  }
  if (!q && kind === 'person') return [];
  const found = await api.suggestLinks(q, kind === 'person' ? 'person' : undefined);
  return found.filter((f) => f.kind === (kind === 'person' ? 'person' : 'note')).slice(0, 8).map((f) => ({ ref_table: kind === 'person' ? 'people' : 'notes', ref_id: f.id, label: f.label }));
}

// Mounts the board in `host`. large: opened on its own page. Returns { refresh, destroy }.
export async function mountBoard(host, boardId, { large = false, onOpen = null } = {}) {
  let board;
  try { board = await request('GET', `/api/boards/${boardId}`); } catch {
    host.replaceChildren(el('p', { class: 'empty' }, 'This board is not here any more.'));
    return { refresh() {}, destroy() {} };
  }
  const stage = el('div', { class: 'board-stage' });
  const arrows = svgEl('svg', { class: 'board-arrows', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  const marker = svgEl('marker', { id: `head-${boardId}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.append(svgEl('path', { d: 'M1 1 L9 5 L1 9', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  defs.append(marker);
  arrows.append(defs);
  const frame = el('div', { class: 'board-frame' }, stage);
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const bar = el('div', { class: 'board-bar' });
  const formPlace = el('div', { class: 'board-form-place' });
  const root = el('section', { class: `board${large ? ' is-large' : ''}`, 'aria-label': `Board: ${board.title || 'Untitled board'}`, 'data-board': boardId }, bar, formPlace, frame, problem);
  host.replaceChildren(root);

  let penOn = false; // the Pen tool is on
  let arrowMode = false; // the Arrow tool is on
  let arrowFrom = null; // the card an arrow starts at, while the tool waits for the second one
  const say = (message) => { problem.textContent = message ?? ''; };
  const guard = (fn) => async (...args) => { try { say(''); await fn(...args); } catch (err) { say(err.message || "That didn't go through."); } };
  const scale = () => (frame.clientWidth ? frame.clientWidth / WIDTH : 1);
  const fit = () => { const k = scale(); stage.style.transform = `scale(${k})`; frame.style.height = `${HEIGHT * k}px`; };
  const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  resizer?.observe(frame);

  const ink = inkLayer({
    strokes: board.strokes ?? [],
    // Every stroke is kept as it was drawn: its points with pressure and time.
    onStroke: (points) => void guard(async () => { await request('POST', `/api/boards/${boardId}/strokes`, { points }); await refresh(); })(),
  });
  const pageFile = el('input', { type: 'file', accept: 'image/*,application/pdf,.pdf', hidden: true, 'aria-label': 'Choose a page' });
  pageFile.addEventListener('change', guard(async () => {
    const file = pageFile.files[0];
    if (!file) return;
    const kept = await api.uploadFile(file);
    await request('PATCH', `/api/boards/${boardId}`, { background: { sha256: kept.sha256 } });
    pageFile.value = '';
    await refresh();
  }));

  const boxOf = (item) => { const node = stage.querySelector(`[data-item="${item.id}"]`); return { x: item.x, y: item.y, w: item.w, h: node && item.kind !== 'arrow' ? node.offsetHeight || item.h : item.h }; };

  function drawArrows() {
    for (const old of arrows.querySelectorAll('.board-arrow')) old.remove();
    const things = new Map(board.items.filter((i) => i.kind !== 'arrow').map((i) => [i.id, i]));
    for (const a of board.items.filter((i) => i.kind === 'arrow')) {
      const from = things.get(a.from_id);
      const to = things.get(a.to_id);
      if (!from || !to) continue;
      const { from: p, to: q } = edgePoints(boxOf(from), boxOf(to));
      const line = svgEl('line', { class: `board-arrow${a.origin === 'assistant' ? ' is-assistant' : ''}`, 'data-arrow': a.id, x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: 'currentColor', 'stroke-width': 4, 'marker-end': `url(#head-${boardId})` });
      arrows.append(line);
    }
  }

  function draw() {
    root.setAttribute('aria-label', `Board: ${board.title || 'Untitled board'}`);
    const things = board.items.filter((i) => i.kind !== 'arrow');
    ink.paint(board.strokes ?? []);
    ink.setPen(penOn);
    const page = board.background ? (board.background.type === 'application/pdf'
      ? el('object', { class: 'board-page', data: `/files/${board.background.sha256}`, type: 'application/pdf', 'aria-label': `Page: ${board.background.name}` })
      : el('img', { class: 'board-page', src: `/files/${board.background.sha256}`, alt: `Page: ${board.background.name}` })) : null;
    stage.replaceChildren(...(page ? [page] : []), arrows, ...things.map((item) => {
      const node = boardCard(item, { selected: arrowFrom === item.id, onRemove: guard(async () => { await request('DELETE', `/api/board-items/${item.id}`); await refresh(); }) });
      node.tabIndex = 0;
      node.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button, a, input')) return;
        if (arrowMode || penOn) return; // the Arrow or Pen tool is on: a click, not a drag
        node.setPointerCapture?.(event.pointerId);
        const k = scale();
        const start = { x: event.clientX, y: event.clientY, ix: item.x, iy: item.y };
        let moved = false;
        const move = (e) => {
          moved = true;
          item.x = Math.max(0, Math.min(WIDTH - 40, start.ix + (e.clientX - start.x) / k));
          item.y = Math.max(0, Math.min(HEIGHT - 20, start.iy + (e.clientY - start.y) / k));
          node.style.left = `${item.x}px`;
          node.style.top = `${item.y}px`;
          drawArrows();
        };
        const up = guard(async () => {
          node.removeEventListener('pointermove', move);
          node.removeEventListener('pointerup', up);
          if (moved) await request('PATCH', `/api/board-items/${item.id}`, { x: Math.round(item.x), y: Math.round(item.y) });
        });
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up);
      });
      node.addEventListener('click', (event) => {
        if (!arrowMode || event.target.closest('button')) return;
        if (arrowFrom === null) { arrowFrom = item.id; say('Now press the card it points to.'); draw(); return; }
        if (arrowFrom === item.id) { arrowFrom = null; draw(); return; }
        const from = arrowFrom;
        arrowMode = false;
        arrowFrom = null;
        say('');
        void guard(async () => { await request('POST', `/api/boards/${boardId}/items`, { kind: 'arrow', from_id: from, to_id: item.id }); await refresh(); })();
      });
      node.addEventListener('dblclick', (event) => {
        if (item.live || event.target.closest('button')) return;
        const input = el('input', { class: 'board-edit', 'aria-label': 'Its words', value: item.text });
        node.replaceChildren(input);
        input.focus();
        const done = guard(async (keep) => {
          if (keep && input.value.trim() && input.value.trim() !== item.text) await request('PATCH', `/api/board-items/${item.id}`, { text: input.value.trim() });
          await refresh();
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void done(true); else if (e.key === 'Escape') void done(false); });
        input.addEventListener('blur', () => void done(true));
      });
      if (item.live && !item.live.missing && item.live.path) {
        const open = el('a', { class: 'board-open-card', href: item.live.path, 'aria-label': `Open ${item.live.title}` }, icon('open'));
        open.addEventListener('click', (event) => { event.preventDefault(); document.dispatchEvent(new CustomEvent('app-navigate', { detail: item.live.path })); });
        node.append(open);
      }
      return node;
    }), ink.element);
    requestAnimationFrame(drawArrows);
    drawArrows();
    fit();
    drawBar();
  }

  const freeSpot = () => { const n = board.items.filter((i) => i.kind !== 'arrow').length; return { x: 40 + (n % 3) * 380, y: 40 + (Math.floor(n / 3) % 4) * 160 }; };

  function wordsForm(kind) {
    const input = el('input', { class: 'search-input', 'aria-label': kind === 'text' ? 'Words' : 'Words on the card', placeholder: kind === 'text' ? 'Words on the board' : 'Words on the card', autocomplete: 'off' });
    const add = guard(async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      await request('POST', `/api/boards/${boardId}/items`, { kind, text: input.value.trim(), ...freeSpot() });
      formPlace.replaceChildren();
      await refresh();
    });
    formPlace.replaceChildren(el('form', { class: 'board-form', onsubmit: add }, input, el('button', { type: 'submit', class: 'button' }, 'Add'), el('button', { type: 'button', class: 'button button-quiet', onclick: () => formPlace.replaceChildren() }, 'Cancel')));
    input.focus();
  }

  function refForm(kind) {
    const input = el('input', { class: 'search-input', 'aria-label': `Find a ${kind}`, placeholder: `Find a ${kind}`, autocomplete: 'off' });
    const results = el('ul', { class: 'board-results', 'aria-label': 'Found' });
    let run = 0;
    const find = async () => {
      const mine = ++run;
      let found = [];
      try { found = await candidates(kind, input.value); } catch { found = []; }
      if (mine !== run) return;
      results.replaceChildren(...(found.length ? found.map((f) => el('li', {}, el('button', { type: 'button', class: 'button button-quiet', onclick: guard(async () => {
        await request('POST', `/api/boards/${boardId}/items`, { kind: 'card', ref_table: f.ref_table, ref_id: f.ref_id, ...freeSpot() });
        formPlace.replaceChildren();
        await refresh();
      }) }, f.label))) : [el('li', { class: 'empty' }, 'Nothing found.')]));
    };
    input.addEventListener('input', () => void find());
    formPlace.replaceChildren(el('div', { class: 'board-form' }, input, el('button', { type: 'button', class: 'button button-quiet', onclick: () => formPlace.replaceChildren() }, 'Cancel')), results);
    input.focus();
    void find();
  }

  function drawBar() {
    const addMenu = el('div', { class: 'board-add', role: 'group', 'aria-label': 'Add to the board' },
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => wordsForm('card') }, 'Card'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => wordsForm('text') }, 'Text'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => refForm('note') }, 'Note'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => refForm('person') }, 'Person'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => refForm('task') }, 'Task'),
      el('button', { type: 'button', class: 'button button-quiet', 'aria-pressed': String(penOn), onclick: () => { penOn = !penOn; if (penOn) arrowMode = false; arrowFrom = null; say(penOn ? 'Draw with the pen. Press Pen again to move cards.' : ''); draw(); } }, 'Pen'),
      ...((board.strokes ?? []).some((s) => !s.faded) ? [el('button', { type: 'button', class: 'button button-quiet', onclick: guard(toText) }, 'To text')] : []),
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => pageFile.click() }, 'Page'),
      ...(board.background ? [el('button', { type: 'button', class: 'button button-quiet', onclick: guard(async () => { await request('PATCH', `/api/boards/${boardId}`, { background: null }); await refresh(); }) }, 'No page')] : []),
      pageFile,
      el('button', { type: 'button', class: 'button button-quiet', 'aria-pressed': String(arrowMode), onclick: () => { arrowMode = !arrowMode; arrowFrom = null; say(arrowMode ? 'Press the card the arrow starts at.' : ''); draw(); } }, 'Arrow'));
    bar.replaceChildren(el('span', { class: 'board-title' }, icon('board'), el('strong', {}, board.title || 'Untitled board')), addMenu,
      ...(!large && onOpen ? [el('button', { type: 'button', class: 'button button-quiet', onclick: () => onOpen(board) }, 'Open')] : []));
  }

  // To text: your assistant reads the handwriting not yet turned into words; the words come as a text item and the ink fades below them.
  async function toText() {
    const loose = (board.strokes ?? []).filter((s) => !s.faded);
    const picture = renderStrokes(loose);
    if (!picture) return;
    say('Your assistant is reading the handwriting…');
    try {
      await request('POST', `/api/boards/${boardId}/ink-to-text`, { stroke_ids: loose.map((s) => s.id), image: picture.dataUrl, x: picture.x, y: picture.y });
      say('');
    } catch (err) { say(err.message); return; }
    await refresh();
  }

  async function refresh() {
    board = await request('GET', `/api/boards/${boardId}`);
    draw();
  }

  draw();
  return { refresh, destroy() { resizer?.disconnect(); } };
}
