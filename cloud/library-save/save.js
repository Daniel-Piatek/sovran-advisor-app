// "Keep this chat saved": the one tool the Sovran Library (library-mcp) gains so that a student's AI can save a
// chat to their Sovran Advisor. It runs inside library-mcp's own request (core.js: the key is already checked,
// the transaction runs as library_reader with library.student_id set). What it does:
//   1. asks the drop box for the public key the student's computer registered (phone_drop.saver_key);
//   2. seals the turns to that key (sealing.js): from here on only that computer can read them;
//   3. leaves the sealed text in the student's drop box (phone_drop.save_note).
// Nothing readable is stored or logged: core.js logs redactSave(args) (counts only) instead of the words.
// The student's computer collects it within a minute of being on and joins the parts into one Inbox item.
//
// In core.js (the only lines that change there):
//   import { SAVE_TOOL, SAVE_INSTRUCTIONS, saveToAdvisor, redactSave } from './save.js';
//   INSTRUCTIONS: the words "It is read-only." become "It only reads, except save_to_my_sovran_advisor." + SAVE_INSTRUCTIONS
//   TOOLS: [..., SAVE_TOOL]            tools: { ..., [SAVE_TOOL.name]: saveToAdvisor }
//   runTool: log redactSave(name, args) wherever it logs args.

import { sealTo } from './sealing.js';

export const MAX_SAVE_CHARS = 30000; // one call; a longer chat goes in several calls
const MAX_TURNS = 40;
const CHAT_ID = /^[a-z0-9]{12}$/;

const OFFER = 'Would you like me to keep this chat saved to your Sovran Advisor?';

// The order matters and is said three times (here, in the tool's description, in its answer): the first live test
// (18 Nov 2026) showed an assistant putting its answer only into the save and showing the student just "Saved".
const ANSWER_FIRST = 'The save is an extra copy, never the answer itself: always write your full answer to the student in the chat first, '
  + 'exactly as you would with no saving, and only after that call the tool with a copy of what you just wrote. '
  + 'A reply that only says it was saved is a mistake.';

export const SAVE_INSTRUCTIONS = ' Saving: after your first answer in a chat that used this library, end that answer by asking once, in these words: '
  + `"${OFFER}" If the student says yes, call save_to_my_sovran_advisor with every question and answer so far, word for word, and say in one short line: "Saved to your Sovran Advisor." `
  + 'For every later question in the same chat: answer it fully in the chat first, then call the tool again with only that new question and answer and the chat_id it gave you, and say nothing about the save. '
  + `${ANSWER_FIRST} If the student says no, do not ask again in this chat; save only if they ask ("save this"). `
  + 'Never save without the student\'s yes.';

export const SAVE_TOOL = {
  name: 'save_to_my_sovran_advisor',
  description: 'Saves this chat to the student\'s own Sovran Advisor, where it arrives in their Inbox as one item per chat. '
    + `Use it only after the student said yes to "${OFFER}" (ask that once, after your first answer in a chat that used this library), or when they ask you to save. `
    + 'First save: send every question and answer so far, word for word, with no chat_id; the answer gives you a chat_id. '
    + 'For each later question in the same chat: first write your full answer in the chat, then call this again with that chat_id and only the new turn, and say nothing about the save. '
    + `${ANSWER_FIRST} `
    + 'If the student asks to "save this" later, send everything not saved yet; a turn sent twice is kept once. '
    + 'The words are scrambled for the student\'s own computer before they are stored; nobody else can read them.',
  inputSchema: { type: 'object', properties: {
    chat_id: { type: 'string', description: 'The chat_id from the first save in this chat. Leave it out on the first save.' },
    title: { type: 'string', description: 'A short title for this chat, a few words.' },
    assistant: { type: 'string', description: 'Your own name, for the label on the saved item, e.g. "Claude" or "ChatGPT".' },
    turns: { type: 'array', minItems: 1, description: 'The questions and answers to save, in order.', items: { type: 'object', properties: {
      number: { type: 'integer', minimum: 1, description: 'Which question of this chat it is, counting from 1.' },
      asked: { type: 'string', description: 'What the student asked, word for word.' },
      answer: { type: 'string', description: 'Your answer, word for word (or as the student asked for it: a summary, or just the last answer).' } },
    required: ['number', 'asked', 'answer'], additionalProperties: false } } },
  required: ['turns'], additionalProperties: false },
};

// What the access log keeps of a save: how much, never the words.
export function redactSave(name, args) {
  if (name !== SAVE_TOOL.name) return args;
  const turns = Array.isArray(args?.turns) ? args.turns : [];
  return { chat_id: CHAT_ID.test(String(args?.chat_id ?? '')) ? args.chat_id : null, turns: turns.length,
    chars: turns.reduce((n, t) => n + String(t?.asked ?? '').length + String(t?.answer ?? '').length, 0) };
}

const newChatId = () => [...globalThis.crypto.getRandomValues(new Uint8Array(12))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const NOT_LINKED = 'Not saved. This Sovran Advisor is not set up for saving chats yet. Tell the student, in plain words: on their computer, '
  + 'open Sovran Advisor, update it (Settings › Updates), switch on Phone capture (Settings › Modules), and leave it open for a minute; then ask again. '
  + 'Do not offer to save again in this chat.';

// The tool. tx: library-mcp's transaction (a postgres.js tagged template); the student is already known to it.
export async function saveToAdvisor(tx, _student, args) {
  const said = (text) => ({ text, results: 0 });
  const turns = (Array.isArray(args?.turns) ? args.turns : []).map((t) => ({
    n: Number.isSafeInteger(t?.number) && t.number > 0 ? t.number : null,
    asked: String(t?.asked ?? '').trim(), answer: String(t?.answer ?? '').trim() })).filter((t) => t.asked || t.answer);
  if (!turns.length) return said('Not saved: send at least one turn with what was asked and the answer.');
  if (turns.length > MAX_TURNS) return said(`Not saved: send at most ${MAX_TURNS} turns in one call; send the rest in a second call with the same chat_id.`);
  if (turns.some((t) => t.n === null)) return said('Not saved: every turn needs its number (which question of this chat it is, from 1).');
  const chars = turns.reduce((n, t) => n + t.asked.length + t.answer.length, 0);
  if (chars > MAX_SAVE_CHARS) return said(`Not saved: that is ${chars} characters and one call takes ${MAX_SAVE_CHARS}. Send fewer turns per call (the same chat_id each time).`);
  if (args.chat_id !== undefined && !CHAT_ID.test(String(args.chat_id))) return said('Not saved: that is not a chat_id from an earlier save. Leave chat_id out to start a new saved chat.');

  const [{ k }] = await tx`SELECT phone_drop.saver_key() AS k`;
  if (!k) return said(NOT_LINKED);
  const chatId = args.chat_id ?? newChatId();
  const sealed = await sealTo(k, {
    kind: 'chat', chat_id: chatId, title: String(args.title ?? '').trim().slice(0, 120), assistant: String(args.assistant ?? '').trim().slice(0, 40),
    turns, at: new Date().toISOString() });
  const [{ r }] = await tx`SELECT phone_drop.save_note(${sealed}) AS r`;
  if (r === 'none') return said(NOT_LINKED);
  if (r === 'full') return said('Not saved: too much is waiting for the student\'s computer. Ask them to open Sovran Advisor on their computer, then save again.');
  if (r === 'busy') return said('Not saved: too many saves in the last hour. Try again later; "save this" then sends what was missed.');
  if (r !== 'ok') return said('Not saved: the drop box refused it.');
  const numbers = turns.map((t) => t.n);
  const first = args.chat_id === undefined;
  return { results: turns.length, text: `Saved (${turns.length === 1 ? `question ${numbers[0]}` : `questions ${Math.min(...numbers)} to ${Math.max(...numbers)}`}). chat_id: ${chatId}. `
    + 'It will be in the student\'s Inbox when their computer is on. '
    + (first ? 'Tell them in one short line: "Saved to your Sovran Advisor." ' : 'Say nothing about this save. If your answer to the student\'s last question is not already written in the chat, write it now, in full. ')
    + `For every later question in this chat: write your full answer in the chat first, then call this tool with chat_id ${chatId} and only the new turn. ${ANSWER_FIRST}` };
}
