// What a call says aloud (advanced/voice/3-4), in plain words. Shared by the page and the tests.

// The first sentences of an answer in plain words (no marks, no links, no tables), at most about 300 letters;
// longer, it ends with "The rest is in the chat."
export function spokenVersion(markdown, { max = 300 } = {}) {
  const plain = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ') // a table is read in the chat, not aloud
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const sentences = plain.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let said = '';
  for (const s of sentences) { if ((said + s).length > max) break; said += s; }
  said = said.trim() || `${plain.slice(0, max).replace(/\s+\S*$/, '')}…`;
  return `${said} The rest is in the chat.`;
}

// A card's words, said aloud: "Add a task: “Call the venue” · Tomorrow" → "add a task, Call the venue, Tomorrow".
export const cardSaid = (what) => String(what ?? '').replace(/[“”"]/g, '').replace(/\s+·\s+/g, ', ').replace(/:\s+/g, ', ').trim();

// Your words start with something to do (advanced/voice/4): the call says "Working on it." at once.
export const asksToDo = (words) => /^(please\s+|can you\s+|could you\s+)?(add|draft|write|plan|move|put|create|make|remind|log|schedule|note down|book|set|send|tick|mark|start|update|change)\b/i.test(String(words ?? '').trim());

// Yes or no to a card that asks first: 'yes', 'no', or null when it was neither.
export function yesOrNo(words) {
  const w = String(words ?? '').toLowerCase().replace(/[^a-z' ]/g, ' ').trim();
  if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|please|correct|right)\b/.test(w)) return 'yes';
  if (/^(no|nope|nah|don't|do not|not now|cancel|stop|leave it)\b/.test(w)) return 'no';
  return null;
}

// The one short, true line said when your assistant needs more than a second (advanced/voice/6).
export function fillerFor(words) {
  const w = String(words ?? '').toLowerCase();
  if (/\b(note|notes|wrote|write about|written)\b/.test(w)) return 'Let me look at your notes.';
  if (/\b(journal|diary)\b/.test(w)) return 'Let me look at your journal.';
  if (/\b(calendar|meeting|event|week|tomorrow)\b/.test(w)) return 'Let me check your calendar.';
  if (/\b(task|tasks|to-?do|todos)\b/.test(w)) return 'Let me look at your tasks.';
  return 'Let me check.';
}

// The time to the first word, in plain words: "first word 0.9 s".
export const firstWordWords = (ms) => `first word ${(Math.round(ms / 100) / 10).toFixed(1)} s`;
