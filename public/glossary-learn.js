// Learning from your corrections (the Voice module, advanced/voice/2). After a dictation lands in a
// field, what the field says about those words is compared with what was dictated. One to three
// words changed inside the dictated words: that is a fix to propose ("You wrote Nordlicht where it
// heard North light"). Never a number, a link, or a sentence you rewrote.
// Pure functions, no page needed: tests/unit/glossary-learn.test.js.

const strip = (word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const words = (text) => text.trim().split(/\s+/).filter(Boolean);

// Compares what was dictated with what the field says now. Returns { heard_as, term } or null.
export function proposeFix(dictated, now) {
  const a = words(dictated);
  const b = words(now);
  let from = 0;
  while (from < a.length && from < b.length && strip(a[from]) === strip(b[from])) from++;
  let back = 0;
  while (back < a.length - from && back < b.length - from && strip(a[a.length - 1 - back]) === strip(b[b.length - 1 - back])) back++;
  const heard = a.slice(from, a.length - back).map(strip).filter(Boolean);
  const written = b.slice(from, b.length - back).map(strip).filter(Boolean);
  if (!heard.length || !written.length || heard.length > 3 || written.length > 3) return null;
  const [heard_as, term] = [heard.join(' '), written.join(' ')];
  if (heard_as === term) return null;
  if (/\d|https?:|www\.|@|\//i.test(`${heard_as} ${term}`)) return null; // a number, a link or an address
  return { heard_as, term };
}

// The part of a field's text that the dictation became: between what stood before it and what
// stood after it (the few letters around the cursor when it was written). Null when they can't be found.
export function regionOf(text, pre, post) {
  let start = 0;
  if (pre) {
    const at = text.indexOf(pre);
    if (at < 0) return null;
    start = at + pre.length;
  }
  let end = text.length;
  if (post) {
    const at = text.indexOf(post, start);
    if (at < 0) return null;
    end = at;
  }
  return text.slice(start, end);
}

// What a dictation says after the fixes: each heard_as (any case, whole words) written as its term.
// The same rule as the server's (glossary.js applyFixes).
export function applyFixes(text, list) {
  let fixed = 0;
  let out = text;
  for (const { heard_as: heard, term } of [...list].sort((a, b) => b.heard_as.length - a.heard_as.length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(pattern, () => { fixed++; return term; });
  }
  return { text: out, fixed };
}
