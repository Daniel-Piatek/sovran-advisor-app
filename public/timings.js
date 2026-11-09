// Every calendar action is measured (Calendar in depth, advanced/calendar/10): from the moment you ask (a click, a key, a drop) to the next
// frame after its result has been drawn. The last fifty are kept in this browser, and Settings › Calendar lists them. A test over a
// full week fails when an action takes 100 ms: the timings are a test, not a promise in a brochure.

export const BUDGET_MS = 100;
const KEY = 'calendar.timings';
const KEEP = 50;

export function readTimings() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.slice(-KEEP) : []; } catch { return []; }
}

export function recordTiming(name, ms) {
  try {
    const list = readTimings();
    list.push({ name, ms: Math.round(ms * 10) / 10, at: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-KEEP)));
  } catch { /* the timing just is not kept */ }
}

// Starts a stopwatch; the returned function stops it once the result is on screen (the next frame).
export function startTiming(name) {
  const t0 = performance.now();
  return () => requestAnimationFrame(() => recordTiming(name, performance.now() - t0));
}
