// How words look, as kept in the Markdown (2026-11-24, public/format-bar.js): Pandoc's bracketed words.
//   [words]{.underline}   [words]{.c-red}  a text colour   [words]{.hl-red}  a highlight behind the words
// A markdown-it plugin, used by the editor (public/editor.js) and by the server where it writes the same Markdown out
// as HTML (quest-weeks.js, the Google Doc master copy). It is read before links, so [words](address) is still a link;
// anything else in braces stays plain text. No imports, so the server can load it too.

// The twelve colours, in the owner's order: the brand's three first, then the rest.
export const COLOURS = 'crimson gold violet red orange yellow green teal blue pink brown grey'.split(' ');

const CLASSES = /^\{((?:\s*\.[a-z-]+)+)\s*\}/;
// → { type: 'underline' | 'colour' | 'highlight', name? }, or null for a class that isn't one of these.
export function spanOf(name) {
  if (name === 'underline') return { type: 'underline' };
  const [, kind, colour] = /^(c|hl)-([a-z]+)$/.exec(name) ?? [];
  if (!COLOURS.includes(colour)) return null;
  return { type: kind === 'c' ? 'colour' : 'highlight', name: colour };
}

// Each span becomes a pair of tokens: underline_open/_close, colour_open/_close or highlight_open/_close, the colour's
// name in the attribute "name".
export function markdownSpans(md) {
  md.inline.ruler.before('link', 'span', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5B /* [ */) return false;
    const end = md.helpers.parseLinkLabel(state, state.pos, false);
    if (end < 0) return false;
    const braces = CLASSES.exec(state.src.slice(end + 1));
    if (!braces) return false;
    const spans = braces[1].trim().split(/\s+/).map((c) => spanOf(c.slice(1)));
    if (!spans.length || spans.some((s) => !s)) return false;
    if (!silent) {
      const [pos, max] = [state.pos, state.posMax];
      for (const s of spans) { const token = state.push(`${s.type}_open`, '', 1); if (s.name) token.attrSet('name', s.name); }
      state.pos = pos + 1;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = max;
      for (const s of [...spans].reverse()) state.push(`${s.type}_close`, '', -1);
    }
    state.pos = end + 1 + braces[0].length;
    return true;
  });
  return md;
}
