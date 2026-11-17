// Finding a highlight's words again in a report's text (My reports on Sovran Go). The same way as the computer's
// Reports page (public/report-marks.js: locate, textIndex, offsetOf, wrap and the choosing of whole words), so a
// highlight made on either sits on the same words on both: a unit test keeps the two alike.

export const AROUND = 32; // letters kept before and after the words, to tell one place from another

// The words of one section as one string, with each text node's place in it.
export function textIndex(root) {
  const nodes = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) { nodes.push({ node, start: text.length }); text += node.data; }
  return { text, nodes };
}
// A point in the page as a place in a section's text: the length of the words from the section's start up to it.
export function offsetOf(root, container, offset) {
  const range = document.createRange();
  range.setStart(root, 0);
  try { range.setEnd(container, offset); } catch { return null; }
  return range.toString().length;
}

// Where a mark's words are in a section's text, best by the words around them, or null.
export function locate(text, { quote, prefix = '', suffix = '' }) {
  let best = null;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    let score = 0;
    const before = text.slice(Math.max(0, at - prefix.length), at);
    for (let i = 1; i <= Math.min(before.length, prefix.length) && before.at(-i) === prefix.at(-i); i++) score += 1;
    const after = text.slice(at + quote.length, at + quote.length + suffix.length);
    for (let i = 0; i < Math.min(after.length, suffix.length) && after[i] === suffix[i]; i++) score += 1;
    if (!best || score > best.score) best = { start: at, end: at + quote.length, score };
  }
  return best;
}

// Wraps text start..end of a section in <mark>s (one per text node it crosses).
export function wrap(index, start, end, attrs) {
  const made = [];
  for (const { node, start: s } of index.nodes) {
    const e = s + node.data.length;
    if (e <= start || s >= end || !node.data.length) continue;
    let target = node;
    const from = Math.max(start, s) - s;
    const to = Math.min(end, e) - s;
    if (to < target.data.length) target.splitText(to);
    if (from > 0) target = target.splitText(from);
    const mark = document.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) mark.setAttribute(k, v);
    target.parentNode.insertBefore(mark, target);
    mark.append(target);
    made.push(mark);
  }
  return made;
}

// The chosen words in one section's text, from start to end: no spaces at the edges, a part-chosen word taken whole.
export function wholeWords(text, start, end) {
  while (start < end && /\s/.test(text[start])) start += 1; // no spaces at the edges
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  const letter = (c) => c != null && /[\p{L}\p{N}’'-]/u.test(c); // whole words: a part-chosen word is taken whole
  while (start > 0 && letter(text[start - 1]) && letter(text[start])) start -= 1;
  while (end < text.length && letter(text[end]) && letter(text[end - 1])) end += 1;
  const quote = text.slice(start, end);
  if (!quote || quote.length > 2000) return null;
  return { quote, prefix: text.slice(Math.max(0, start - AROUND), start), suffix: text.slice(end, end + AROUND) };
}
