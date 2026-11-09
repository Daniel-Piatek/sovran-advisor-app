// The pen on a board (advanced/writing/8): ink as it was drawn. Every stroke is a list of points [x, y, pressure, ms]; the line is drawn
// thicker where the pen pressed harder (a mouse presses at 0.5). Ink is drawn in its own layer over the board and is never deleted by reading
// it as words: it fades below them. The words are read by your assistant (public/board.js asks, ink.js on the server keeps).

const NS = 'http://www.w3.org/2000/svg';
export const MIN_WIDTH = 3;
export const MAX_WIDTH = 14;

// A stroke as one filled outline that is wider where the pressure is higher.
export function strokePath(points, { min = MIN_WIDTH, max = MAX_WIDTH } = {}) {
  if (!points.length) return '';
  const half = (p) => (min + (max - min) * (p[2] ?? 0.5)) / 2;
  if (points.length === 1) {
    const [x, y] = points[0];
    const r = half(points[0]);
    return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const w = half(points[i]);
    left.push([points[i][0] - dy * w, points[i][1] + dx * w]);
    right.push([points[i][0] + dy * w, points[i][1] - dx * w]);
  }
  const f = (n) => Math.round(n * 10) / 10;
  return `M${left.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}L${right.reverse().map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
}

// The ink layer: an svg over the board. onStroke(points) runs for each stroke drawn while the pen is on.
export function inkLayer({ strokes = [], onStroke = () => {} } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'board-ink');
  svg.setAttribute('viewBox', '0 0 1200 700');
  svg.setAttribute('aria-label', 'Ink');
  const group = document.createElementNS(NS, 'g');
  svg.append(group);
  let pen = false;
  const paint = (list) => {
    group.replaceChildren(...list.map((s) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', `ink-stroke${s.faded ? ' is-faded' : ''}`);
      path.setAttribute('data-stroke', s.id ?? '');
      path.setAttribute('d', strokePath(s.points));
      path.setAttribute('fill', 'currentColor');
      return path;
    }));
  };
  paint(strokes);

  let live = null;
  const at = (event) => {
    const box = svg.getBoundingClientRect();
    const k = box.width ? 1200 / box.width : 1;
    return [Math.round((event.clientX - box.left) * k * 10) / 10, Math.round((event.clientY - box.top) * k * 10) / 10];
  };
  svg.addEventListener('pointerdown', (event) => {
    if (!pen) return;
    event.preventDefault();
    svg.setPointerCapture?.(event.pointerId);
    const began = performance.now();
    const pressure = (e) => (e.pointerType === 'mouse' || !e.pressure ? 0.5 : e.pressure);
    live = { points: [[...at(event), pressure(event), 0]], began, pressure };
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', 'ink-stroke is-live');
    path.setAttribute('fill', 'currentColor');
    group.append(path);
    live.path = path;
    path.setAttribute('d', strokePath(live.points));
  });
  svg.addEventListener('pointermove', (event) => {
    if (!live) return;
    live.points.push([...at(event), live.pressure(event), Math.round(performance.now() - live.began)]);
    live.path.setAttribute('d', strokePath(live.points));
  });
  const end = () => {
    if (!live) return;
    const { points, path } = live;
    live = null;
    path.remove();
    onStroke(points);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  return {
    element: svg,
    paint,
    setPen(on) { pen = on; svg.classList.toggle('is-pen', on); },
  };
}

// The strokes as a picture, to be read as words: black ink on the page colour, cropped to where it was drawn. Returns { dataUrl, x, y } or null.
export function renderStrokes(strokes) {
  const points = strokes.flatMap((s) => s.points);
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const pad = MAX_WIDTH;
  const x = Math.max(0, Math.min(...xs) - pad);
  const y = Math.max(0, Math.min(...ys) - pad);
  const w = Math.min(1200, Math.max(...xs) + pad) - x;
  const h = Math.min(700, Math.max(...ys) + pad) - y;
  const scale = Math.min(3, 1200 / Math.max(w, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--color-bg').trim() || 'Canvas';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = css.getPropertyValue('--color-text').trim() || 'CanvasText';
  for (const s of strokes) {
    const shifted = s.points.map((p) => [(p[0] - x) * scale, (p[1] - y) * scale, p[2], p[3]]);
    ctx.fill(new Path2D(strokePath(shifted, { min: MIN_WIDTH * scale, max: MAX_WIDTH * scale })));
  }
  return { dataUrl: canvas.toDataURL('image/png'), x: Math.round(x), y: Math.round(y) };
}
