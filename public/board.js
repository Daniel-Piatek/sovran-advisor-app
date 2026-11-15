// A board (advanced/writing/6): a canvas of cards, words and arrows, in a note and open large. The canvas is 1200 units wide and scales with
// the page; a card is moved with the mouse (or a finger) and its arrows follow; a card that points at a note, a person or a task shows it
// live, read from its row every time. The Board card and connector are in the design library.
// A board of its own (the Boards tab of Notes, schema 72) is endless: its canvas is board.width by board.height units (20000 each way), seen
// through a window you move (drag the empty canvas, or scroll) and zoom (the − and + buttons, Ctrl or Cmd and scroll, or pinch on a trackpad).
// It also has groups (a coloured box with a name, the cards inside it move with it), quick cards that can become a note, and journal and
// Inbox cards; a double click on a card that points at something calls onPeek, which opens it beside the board (public/board-peek.js).

import { el, icon, request, api } from './ui.js';
import { inkLayer, renderStrokes } from './ink.js';

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

export const GROUP_COLORS = ['goal', 'life', 'notes', 'people', 'tasks', 'plain']; // gold, green, blue, violet, orange, grey: the kinds' colours (style.css)
const COLOUR_NAMES = { goal: 'Gold colour', life: 'Green colour', notes: 'Blue colour', people: 'Violet colour', tasks: 'Orange colour', plain: 'Grey colour' };
const KIND_NAMES = { person: 'Person', task: 'Task', note: 'Note', journal: 'Journal', inbox: 'Inbox' };
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 2.5;

const svgEl = (tag, attrs = {}) => { const node = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node; };

// A card's words: the live thing it points at, or its own words.
function cardBody(item) {
  if (item.live) {
    if (item.live.missing) return [el('span', { class: 'board-card-title' }, 'Removed page'), el('span', { class: 'board-card-kind' }, item.live.kind)];
    return [el('span', { class: 'board-card-kind' }, `${KIND_NAMES[item.live.kind] ?? 'Note'}${item.live.when ? ` · ${item.live.when}` : ''}`),
      el('span', { class: 'board-card-title' }, item.live.title), ...(item.live.sub ? [el('span', { class: 'board-card-sub' }, item.live.sub)] : []), ...(item.text ? [el('span', { class: 'board-card-sub' }, item.text)] : [])];
  }
  return [el('span', { class: 'board-card-title' }, item.text)];
}

// One card or piece of text, as the board draws it. Used by the library too.
export function boardCard(item, { selected = false, onRemove = null } = {}) {
  const node = el('div', {
    class: `board-card is-${item.kind}${item.live ? ` is-live is-${item.live.kind}` : ''}${item.origin === 'assistant' ? ' is-assistant' : ''}${selected ? ' is-selected' : ''}`,
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

// Mounts the board in `host`. large: opened on its own page. onPeek(item): a card that points at something was double-clicked.
// onChange(board): after every load. tools: more buttons for the end of the bar (the page's own, such as Full screen). Returns { refresh, destroy, addAt, root }.
export async function mountBoard(host, boardId, { large = false, onOpen = null, onPeek = null, onChange = null, tools = [] } = {}) {
  let board;
  try { board = await request('GET', `/api/boards/${boardId}`); } catch {
    host.replaceChildren(el('p', { class: 'empty' }, 'This board is not here any more.'));
    return { refresh() {}, destroy() {}, async addAt() {}, root: null };
  }
  const WIDTH = board.width ?? 1200;
  const HEIGHT = board.height ?? 700;
  const endless = board.endless === true;
  const stage = el('div', { class: 'board-stage' });
  stage.style.width = `${WIDTH}px`;
  stage.style.height = `${HEIGHT}px`;
  const arrows = svgEl('svg', { class: 'board-arrows', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, 'aria-hidden': 'true' });
  arrows.style.width = `${WIDTH}px`;
  arrows.style.height = `${HEIGHT}px`;
  const defs = svgEl('defs');
  const marker = svgEl('marker', { id: `head-${boardId}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.append(svgEl('path', { d: 'M1 1 L9 5 L1 9', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  defs.append(marker);
  arrows.append(defs);
  const frame = el('div', { class: `board-frame${endless ? ' is-endless' : ''}`, tabindex: endless ? 0 : null, 'aria-label': endless ? 'The board: drag the empty space to move around' : null }, stage);
  const zoomLabel = el('span', { class: 'board-zoom-value', 'aria-live': 'polite' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const bar = el('div', { class: 'board-bar' });
  const formPlace = el('div', { class: 'board-form-place' });
  const root = el('section', { class: `board${large ? ' is-large' : ''}${endless ? ' is-endless' : ''}`, 'aria-label': `Board: ${board.title || 'Untitled board'}`, 'data-board': boardId }, bar, formPlace, frame, problem);
  host.replaceChildren(root);

  let penOn = false; // the Pen tool is on
  let arrowMode = false; // the Arrow tool is on
  let arrowFrom = null; // the card an arrow starts at, while the tool waits for the second one
  const say = (message) => { problem.textContent = message ?? ''; };
  const guard = (fn) => async (...args) => { try { say(''); await fn(...args); } catch (err) { say(err.message || "That didn't go through."); } };
  // The window onto the canvas. A board in a note: the whole canvas, scaled to the page's width. An endless board: a zoom (k) and where
  // the canvas's corner sits in the window (px, py), remembered in this browser for each board.
  const VIEW_KEY = `board.view.${boardId}`;
  const view = (() => { try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'); if (v && [v.k, v.px, v.py].every(Number.isFinite)) return { ...v, kept: true }; } catch { /* none kept */ } return { k: 1, px: 0, py: 0, kept: false }; })();
  const keepView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ k: view.k, px: view.px, py: view.py })); } catch { /* not kept: fine */ } };
  const scale = () => (endless ? view.k : (frame.clientWidth ? frame.clientWidth / WIDTH : 1));
  const place = () => {
    stage.style.transform = `translate(${view.px}px, ${view.py}px) scale(${view.k})`;
    zoomLabel.textContent = `${Math.round(view.k * 100)}%`;
  };
  let seen = null; // the window's size when last drawn: when it changes (the list or an opened card beside it), the middle stays the middle
  const fit = () => {
    if (endless) {
      const size = { w: frame.clientWidth, h: frame.clientHeight };
      if (seen && size.w && (size.w !== seen.w || size.h !== seen.h)) { view.px += (size.w - seen.w) / 2; view.py += (size.h - seen.h) / 2; keepView(); }
      if (size.w) seen = size;
      place();
      return;
    }
    const k = scale(); stage.style.transform = `scale(${k})`; frame.style.height = `${HEIGHT * k}px`;
  };
  // The middle of what the window shows, in canvas units.
  const centre = () => ({ x: (frame.clientWidth / 2 - view.px) / view.k, y: (frame.clientHeight / 2 - view.py) / view.k });
  const lookAt = (x, y, k = view.k) => { view.k = k; view.px = frame.clientWidth / 2 - x * k; view.py = frame.clientHeight / 2 - y * k; place(); keepView(); };
  const zoomAt = (k, sx = frame.clientWidth / 2, sy = frame.clientHeight / 2) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
    const wx = (sx - view.px) / view.k;
    const wy = (sy - view.py) / view.k;
    view.k = next; view.px = sx - wx * next; view.py = sy - wy * next;
    place(); keepView();
  };
  // Show everything on the board (or its middle, when it is empty).
  const showAll = () => {
    const things = board.items.filter((i) => i.kind !== 'arrow');
    const points = (board.strokes ?? []).flatMap((s) => s.points);
    if (!things.length && !points.length) { lookAt(WIDTH / 2, HEIGHT / 2, 1); return; }
    const xs = [...things.flatMap((i) => [i.x, i.x + i.w]), ...points.map((p) => p[0])];
    const ys = [...things.flatMap((i) => [i.y, i.y + boxOf(i).h]), ...points.map((p) => p[1])];
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(1.2, Math.max(ZOOM_MIN, Math.min((frame.clientWidth - 80) / Math.max(1, x1 - x0), (frame.clientHeight - 80) / Math.max(1, y1 - y0))));
    lookAt((x0 + x1) / 2, (y0 + y1) / 2, k);
  };
  const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  resizer?.observe(frame);

  const ink = inkLayer({
    width: WIDTH,
    height: HEIGHT,
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

  // A group: a coloured box with a name, under the cards. Its name bar moves it (with the cards inside); the corner makes it larger or smaller.
  function groupNode(item) {
    const name = el('span', { class: 'board-group-name' }, item.text || 'Group');
    const colours = el('div', { class: 'board-group-colours', role: 'group', 'aria-label': 'Colour' }, ...GROUP_COLORS.map((c) => el('button', {
      type: 'button', class: `board-swatch is-${c}`, 'aria-label': COLOUR_NAMES[c], 'aria-pressed': String(item.color === c),
      onclick: guard(async (event) => { event.stopPropagation(); await request('PATCH', `/api/board-items/${item.id}`, { color: c }); await refresh(); }),
    })));
    const remove = el('button', { type: 'button', class: 'board-remove', 'aria-label': 'Take the group off the board (the cards stay)', onclick: guard(async (event) => { event.stopPropagation(); await request('DELETE', `/api/board-items/${item.id}`); await refresh(); }) }, icon('close'));
    const head = el('div', { class: 'board-group-head' }, name, colours, remove);
    const corner = el('span', { class: 'board-group-corner', 'aria-hidden': 'true' });
    const node = el('div', { class: `board-group is-${item.color || 'goal'}`, 'data-item': item.id, 'data-kind': 'group', role: 'group', 'aria-label': `Group: ${item.text || 'Group'}` }, head, corner);
    node.style.left = `${item.x}px`; node.style.top = `${item.y}px`; node.style.width = `${item.w}px`; node.style.height = `${item.h}px`;
    // The cards whose middle is inside the group move with it (the server does the same when the move is saved).
    const inside = () => board.items.filter((o) => o.id !== item.id && o.kind !== 'arrow').filter((o) => (o.kind === 'group'
      ? o.x >= item.x && o.y >= item.y && o.x + o.w <= item.x + item.w && o.y + o.h <= item.y + item.h
      : o.x + o.w / 2 >= item.x && o.x + o.w / 2 <= item.x + item.w && o.y + boxOf(o).h / 2 >= item.y && o.y + boxOf(o).h / 2 <= item.y + item.h));
    head.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button, input') || penOn || arrowMode) return;
      event.stopPropagation();
      head.setPointerCapture?.(event.pointerId);
      const k = scale();
      const riders = inside().map((o) => ({ o, x: o.x, y: o.y }));
      const start = { x: event.clientX, y: event.clientY, ix: item.x, iy: item.y };
      let moved = false;
      const move = (e) => {
        moved = true;
        const dx = (e.clientX - start.x) / k;
        const dy = (e.clientY - start.y) / k;
        item.x = Math.max(0, Math.min(WIDTH - 40, start.ix + dx));
        item.y = Math.max(0, Math.min(HEIGHT - 20, start.iy + dy));
        node.style.left = `${item.x}px`; node.style.top = `${item.y}px`;
        for (const r of riders) {
          r.o.x = r.x + (item.x - start.ix); r.o.y = r.y + (item.y - start.iy);
          const n = stage.querySelector(`[data-item="${r.o.id}"]`);
          if (n) { n.style.left = `${r.o.x}px`; n.style.top = `${r.o.y}px`; }
        }
        drawArrows();
      };
      const up = guard(async () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        if (moved) { await request('PATCH', `/api/board-items/${item.id}`, { x: Math.round(item.x), y: Math.round(item.y) }); await refresh(); }
      });
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    corner.addEventListener('pointerdown', (event) => {
      if (penOn || arrowMode) return;
      event.stopPropagation();
      corner.setPointerCapture?.(event.pointerId);
      const k = scale();
      const start = { x: event.clientX, y: event.clientY, w: item.w, h: item.h };
      const move = (e) => {
        item.w = Math.max(160, start.w + (e.clientX - start.x) / k);
        item.h = Math.max(100, start.h + (e.clientY - start.y) / k);
        node.style.width = `${item.w}px`; node.style.height = `${item.h}px`;
      };
      const up = guard(async () => {
        corner.removeEventListener('pointermove', move);
        corner.removeEventListener('pointerup', up);
        await request('PATCH', `/api/board-items/${item.id}`, { w: Math.round(item.w), h: Math.round(item.h) });
      });
      corner.addEventListener('pointermove', move);
      corner.addEventListener('pointerup', up);
    });
    name.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      const input = el('input', { class: 'board-edit', 'aria-label': 'Group name', value: item.text });
      name.replaceChildren(input);
      input.focus();
      input.select();
      let finished = false;
      const done = guard(async (keep) => {
        if (finished) return;
        finished = true;
        if (keep && input.value.trim() !== item.text) await request('PATCH', `/api/board-items/${item.id}`, { text: input.value.trim() });
        await refresh();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void done(true); else if (e.key === 'Escape') void done(false); });
      input.addEventListener('blur', () => void done(true));
    });
    return node;
  }

  function draw() {
    root.setAttribute('aria-label', `Board: ${board.title || 'Untitled board'}`);
    const groups = board.items.filter((i) => i.kind === 'group');
    const things = board.items.filter((i) => i.kind === 'card' || i.kind === 'text');
    ink.paint(board.strokes ?? []);
    ink.setPen(penOn);
    const page = board.background ? (board.background.type === 'application/pdf'
      ? el('object', { class: 'board-page', data: `/files/${board.background.sha256}`, type: 'application/pdf', 'aria-label': `Page: ${board.background.name}` })
      : el('img', { class: 'board-page', src: `/files/${board.background.sha256}`, alt: `Page: ${board.background.name}` })) : null;
    stage.replaceChildren(...(page ? [page] : []), ...groups.map(groupNode), arrows, ...things.map((item) => {
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
        if (event.target.closest('button')) return;
        if (item.live) { if (onPeek && !item.live.missing) onPeek(item); return; }
        const input = el(endless ? 'textarea' : 'input', { class: 'board-edit', 'aria-label': 'Its words', ...(endless ? { rows: 3 } : {}) });
        input.value = item.text;
        node.replaceChildren(input);
        input.focus();
        let finished = false;
        const done = guard(async (keep) => {
          if (finished) return;
          finished = true;
          if (keep && input.value.trim() && input.value.trim() !== item.text) await request('PATCH', `/api/board-items/${item.id}`, { text: input.value.trim() });
          await refresh();
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void done(true); } else if (e.key === 'Escape') void done(false); });
        input.addEventListener('blur', () => void done(true));
      });
      // A quick card of an endless board can become a real note (the card then points at it).
      if (endless && !item.live && item.kind === 'card') {
        node.append(el('button', { type: 'button', class: 'board-to-note', 'aria-label': 'Make it a note', title: 'Make it a note', onclick: guard(async (event) => {
          event.stopPropagation();
          await request('POST', `/api/board-items/${item.id}/to-note`, {});
          await refresh();
        }) }, icon('notes')));
      }
      if (item.live && !item.live.missing && item.live.path) {
        const open = el('a', { class: 'board-open-card', href: item.live.path, 'aria-label': `Open ${item.live.title}` }, icon('open'));
        open.addEventListener('click', (event) => { event.preventDefault(); if (onPeek) onPeek(item); else document.dispatchEvent(new CustomEvent('app-navigate', { detail: item.live.path })); });
        node.append(open);
      }
      return node;
    }), ink.element);
    requestAnimationFrame(drawArrows);
    drawArrows();
    fit();
    drawBar();
  }

  // Where a new card goes: on an endless board, the free place nearest the middle of the window, so cards don't hide each other.
  const freeSpot = (kind = 'card') => {
    if (endless) {
      const c = centre();
      const size = kind === 'group' ? { w: 640, h: 420 } : { w: 280, h: 110 };
      const others = board.items.filter((i) => i.kind === 'card' || i.kind === 'text' || (kind === 'group' && i.kind === 'group')).map(boxOf);
      const free = (x, y) => others.every((o) => x + size.w + 20 <= o.x || o.x + o.w + 20 <= x || y + size.h + 20 <= o.y || o.y + o.h + 20 <= y);
      const start = { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2) };
      const step = { x: size.w + 30, y: size.h + 30 };
      // What the window shows, in canvas units: a place inside it comes first, then the nearest.
      const seenBox = { x0: -view.px / view.k, y0: -view.py / view.k, x1: (frame.clientWidth - view.px) / view.k, y1: (frame.clientHeight - view.py) / view.k };
      const spots = [];
      for (let gy = -6; gy <= 6; gy++) for (let gx = -4; gx <= 4; gx++) {
        const at = { x: start.x + gx * step.x, y: start.y + gy * step.y };
        const inside = at.x >= seenBox.x0 && at.y >= seenBox.y0 && at.x + size.w <= seenBox.x1 && at.y + size.h <= seenBox.y1;
        spots.push({ at, rank: (inside ? 0 : 1e9) + Math.hypot(gx * step.x, gy * step.y) });
      }
      spots.sort((a, b) => a.rank - b.rank);
      const found = spots.find((spot) => free(spot.at.x, spot.at.y));
      if (found) return found.at;
      return start;
    }
    const n = board.items.filter((i) => i.kind !== 'arrow').length; return { x: 40 + (n % 3) * 380, y: 40 + (Math.floor(n / 3) % 4) * 160 };
  };

  function wordsForm(kind) {
    const labels = { text: ['Words', 'Words on the board'], card: ['Words on the card', 'Words on the card'], group: ['Group name', 'Name of the group'] };
    const input = el('input', { class: 'search-input', 'aria-label': labels[kind][0], placeholder: labels[kind][1], autocomplete: 'off' });
    const add = guard(async (event) => {
      event.preventDefault();
      if (!input.value.trim() && kind !== 'group') return;
      formPlace.replaceChildren();
      await addAt({ kind, text: input.value.trim(), ...(kind === 'group' ? { color: GROUP_COLORS[board.items.filter((i) => i.kind === 'group').length % GROUP_COLORS.length] } : {}) });
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
      ...(endless ? [el('button', { type: 'button', class: 'button button-quiet', onclick: () => wordsForm('group') }, 'Group')] : []),
      ...(endless ? [] : [el('button', { type: 'button', class: 'button button-quiet', onclick: () => refForm('note') }, 'Note')]),
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => refForm('person') }, 'Person'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => refForm('task') }, 'Task'),
      el('button', { type: 'button', class: 'button button-quiet', 'aria-pressed': String(penOn), onclick: () => { penOn = !penOn; if (penOn) arrowMode = false; arrowFrom = null; say(penOn ? 'Draw with the pen. Press Pen again to move cards.' : ''); draw(); } }, 'Pen'),
      ...((board.strokes ?? []).some((s) => !s.faded) ? [el('button', { type: 'button', class: 'button button-quiet', onclick: guard(toText) }, 'To text')] : []),
      ...(endless ? [] : [el('button', { type: 'button', class: 'button button-quiet', onclick: () => pageFile.click() }, 'Page')]),
      ...(board.background && !endless ? [el('button', { type: 'button', class: 'button button-quiet', onclick: guard(async () => { await request('PATCH', `/api/boards/${boardId}`, { background: null }); await refresh(); }) }, 'No page')] : []),
      pageFile,
      el('button', { type: 'button', class: 'button button-quiet', 'aria-pressed': String(arrowMode), onclick: () => { arrowMode = !arrowMode; arrowFrom = null; say(arrowMode ? 'Press the card the arrow starts at.' : ''); draw(); } }, 'Arrow'));
    const zoom = endless ? [el('div', { class: 'board-zoom', role: 'group', 'aria-label': 'Zoom' },
      el('button', { type: 'button', class: 'button button-quiet', 'aria-label': 'Zoom out', onclick: () => zoomAt(view.k / 1.25) }, '−'),
      zoomLabel,
      el('button', { type: 'button', class: 'button button-quiet', 'aria-label': 'Zoom in', onclick: () => zoomAt(view.k * 1.25) }, '+'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: showAll }, 'Show all'))] : [];
    bar.replaceChildren(...(endless ? [] : [el('span', { class: 'board-title' }, icon('board'), el('strong', {}, board.title || 'Untitled board'))]), addMenu, ...zoom, ...tools,
      ...(!large && onOpen ? [el('button', { type: 'button', class: 'button button-quiet', onclick: () => onOpen(board) }, 'Open')] : []));
  }

  // To text: your assistant reads the handwriting not yet turned into words; the words come as a text item and the ink fades below them.
  async function toText() {
    const loose = (board.strokes ?? []).filter((s) => !s.faded);
    const picture = renderStrokes(loose, { width: WIDTH, height: HEIGHT });
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
    onChange?.(board);
  }

  // Moving around an endless board: drag the empty canvas (or a group's inside), scroll to move, Ctrl or Cmd and scroll (a pinch) to zoom.
  if (endless) {
    frame.addEventListener('pointerdown', (event) => {
      if (penOn || event.button > 0) return;
      if (event.target.closest('.board-card, .board-group-head, .board-group-corner, button, input, textarea')) return;
      frame.setPointerCapture?.(event.pointerId);
      const start = { x: event.clientX, y: event.clientY, px: view.px, py: view.py };
      frame.classList.add('is-moving');
      const move = (e) => { view.px = start.px + e.clientX - start.x; view.py = start.py + e.clientY - start.y; place(); };
      const up = () => { frame.classList.remove('is-moving'); frame.removeEventListener('pointermove', move); frame.removeEventListener('pointerup', up); frame.removeEventListener('pointercancel', up); keepView(); };
      frame.addEventListener('pointermove', move);
      frame.addEventListener('pointerup', up);
      frame.addEventListener('pointercancel', up);
    });
    frame.addEventListener('wheel', (event) => {
      event.preventDefault();
      const box = frame.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomAt(view.k * Math.exp(-event.deltaY / 300), event.clientX - box.left, event.clientY - box.top);
      else { view.px -= event.deltaX; view.py -= event.deltaY; place(); keepView(); }
    }, { passive: false });
    frame.addEventListener('keydown', (event) => {
      if (event.target !== frame) return;
      const moves = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      if (moves[event.key]) { event.preventDefault(); view.px += moves[event.key][0]; view.py += moves[event.key][1]; place(); keepView(); }
      else if (event.key === '+' || event.key === '=') zoomAt(view.k * 1.25);
      else if (event.key === '-') zoomAt(view.k / 1.25);
    });
    // Something dragged from the list beside the board (public/board-screen.js) lands where it is let go.
    frame.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('application/x-board-ref')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    frame.addEventListener('drop', guard(async (event) => {
      const raw = event.dataTransfer?.getData('application/x-board-ref');
      if (!raw) return;
      event.preventDefault();
      const ref = JSON.parse(raw);
      const box = frame.getBoundingClientRect();
      const x = (event.clientX - box.left - view.px) / view.k - 140;
      const y = (event.clientY - box.top - view.py) / view.k - 40;
      await addAt({ kind: 'card', ref_table: ref.ref_table, ref_id: ref.ref_id, x: Math.round(x), y: Math.round(y) });
    }));
  }

  // A card the window doesn't show (fully) is brought into the middle of it.
  function bringIntoView(item) {
    const box = boxOf(item);
    const sx = box.x * view.k + view.px;
    const sy = box.y * view.k + view.py;
    if (sx < 0 || sy < 0 || sx + box.w * view.k > frame.clientWidth || sy + box.h * view.k > frame.clientHeight) lookAt(box.x + box.w / 2, box.y + box.h / 2);
  }

  // Puts a card on the board (at x, y, or about the middle of the window) and draws the board again.
  async function addAt(input) {
    const at = Number.isFinite(input.x) ? {} : freeSpot(input.kind);
    const item = await request('POST', `/api/boards/${boardId}/items`, { ...input, ...at });
    await refresh();
    if (endless) bringIntoView(item);
    return item;
  }

  draw();
  if (endless) {
    // The window's size is known once it is on the page.
    requestAnimationFrame(() => { if (!view.kept) showAll(); else place(); });
  }
  onChange?.(board);
  return { refresh, destroy() { resizer?.disconnect(); }, addAt: guard(addAt), root, showAll };
}
