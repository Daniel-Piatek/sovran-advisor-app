// The assistant (assistant/1): a chat inside the app where Claude Code answers. Each
// conversation has its own folder in the data folder (assistant/<id>); a message starts
// the claude command there, on the owner's own Claude plan (its login, never an API key),
// continues the same Claude conversation on every turn (--session-id the first time,
// --resume after), and streams the answer back as it arrives. Every message is a row, so
// a conversation reopened shows its history and carries on, even after the app restarts.
// Stop ends the answer under way. Its steps (the tools it uses, the files it makes) are
// kept with the answer.
// It works with the owner's notes, journal and tasks through the app's own tools over MCP
// (mcp.js, assistant-tools.js, assistant/2): only those, allowed without asking, because
// a change it was not asked for comes as a card to apply. An answer keeps its sources (the
// pages it read or linked) and its cards. A question asked from a page carries that page.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { actionsOf, findPage, cancelWaits } from './assistant-tools.js';
import { NEVER_TOOLS, judgeStep, logActivity } from './permissions.js';
import { localDay } from './entries.js';
import { codexArgs, codexEnv, lineReader } from './codex.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

export const MAX_MESSAGE_LENGTH = 20_000;
export const DEFAULT_COMMAND = ['claude'];
const SAVE_EVERY_MS = 1000;
export const guide = () => [
  'You are the assistant inside the owner’s personal app (notes, journal, tasks, planner, people, My Life).',
  `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}, ${localDay()}.`,
  'Answer plainly and briefly. Your own files go in this conversation’s folder.',
  'The app’s tools (mcp__app__…) reach the owner’s data: search_notes and read_note to find and read, list_tasks for tasks.',
  'add_task, add_note and append_to_journal only when the owner asked for that in so many words. Their settings decide whether it is done at once or waits for their approval on a card: the tool’s answer says which, and you say the same.',
  'log_interaction logs what happened with a person outside the app (a call, a coffee, a message) in one sentence, only when the owner asked; it too is done at once or waits on a card, as their settings say.',
  'reconnect_list answers who the owner should be in touch with (people with a rhythm that are due or overdue, from their logged calls and messages); read it for “who should I reconnect with?” and say who is most overdue first.',
  'Any other change (editing or tidying a note, ticking or moving a task) goes through propose_note_edit or propose_task_change. Never say something is done while it waits on a card.',
  'Steps of your own outside this conversation’s folder may need the owner’s yes; if they say no, do not try another way.',
  'To plan the week or the day with the owner: read_week or read_day, say plainly when a day holds too much, then propose each move (a task to another day, a Highlight, a time block) with propose_plan and a one-line reason. Nothing moves until they apply it.',
  'To close the day with them: read_day, ask what became of the Highlight if you do not know, then suggest the day’s line with propose_close_day. It is saved only when they approve it.',
  'With the Sovran Library connected (mcp__library__…), it holds the teaching of the owner’s mentor and, for a client, their own decodes: search it for questions about the Sovran teaching or their decodes, follow any reading note it gives, and say when an answer comes from the library.',
  'When you use a page, cite it as a Markdown link to its path, like [Bank call](/notes/<id>). Quote the owner’s words when they ask what they wrote.',
].join(' ');

const CONVERSATION_COLUMNS = 'id, title, folder, session_id, started, created_at, updated_at, deleted_at';
const MESSAGE_COLUMNS = 'id, conversation_id, role, text, steps, sources, context, state, created_at, updated_at';
const message = (row) => ({ ...row, steps: JSON.parse(row.steps), sources: JSON.parse(row.sources), context: row.context ? JSON.parse(row.context) : null });

export function checkMessageInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (typeof input.text !== 'string' || !input.text.trim()) return 'A message needs words.';
  if (input.text.length > MAX_MESSAGE_LENGTH) return `A message is at most ${MAX_MESSAGE_LENGTH} characters.`;
  if ('context' in input && input.context !== null && (typeof input.context !== 'object' || typeof input.context.path !== 'string'
    || input.context.path.length > 300 || typeof (input.context.title ?? '') !== 'string')) return 'context is { path, title }.';
  return null;
}

// An answer still marked as under way when the app starts was cut off by a stop.
export function settleAnswers(db) {
  db.prepare("UPDATE chat_messages SET state = 'stopped', updated_at = ? WHERE state = 'answering'").run(now());
}

export const listConversations = (db) => db.prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations
  WHERE deleted_at IS NULL ORDER BY updated_at DESC`).all().map((row) => ({ ...row, started: row.started === 1 }));

export function getConversation(db, id, { deleted = false } = {}) {
  const row = db.prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`).get(id);
  if (!row || (row.deleted_at && !deleted)) return null;
  const messages = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? AND deleted_at IS NULL
    ORDER BY created_at, rowid`).all(id).map(message).map((m) => (m.role === 'assistant' ? { ...m, cards: actionsOf(db, m.id) } : m));
  return { ...row, started: row.started === 1, messages };
}

// A new conversation, with its own folder.
export function createConversation(db, dataDir) {
  const id = randomUUID();
  const folder = path.join('assistant', id);
  fs.mkdirSync(path.join(dataDir, folder), { recursive: true });
  const time = now();
  db.prepare('INSERT INTO conversations (id, created_at, updated_at, folder, session_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, time, time, folder, randomUUID());
  return getConversation(db, id);
}

// Deleting only marks it; its messages and folder stay, and Undo brings it back.
export function deleteConversation(db, id) {
  if (!getConversation(db, id)) return null;
  db.prepare('UPDATE conversations SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getConversation(db, id, { deleted: true });
}

export function restoreConversation(db, id) {
  if (!getConversation(db, id, { deleted: true })) return null;
  db.prepare('UPDATE conversations SET deleted_at = NULL WHERE id = ?').run(id);
  return getConversation(db, id);
}

function addMessage(db, conversationId, role, text, state, context = null) {
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO chat_messages (id, created_at, updated_at, conversation_id, role, text, state, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, conversationId, role, text, state, context ? JSON.stringify(context) : '');
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(time, conversationId);
  return id;
}

const getMessage = (db, id) => {
  const found = message(db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ?`).get(id));
  return found.role === 'assistant' ? { ...found, cards: actionsOf(db, id) } : found;
};

// Pages an answer links to, by their path in the app.
const LINKED = /\/(?:notes|journal\/entries|people|companies|life)\/([0-9a-f-]{36})/g;

// A step in a few words: the tool and what it works on.
function describe(name, input = {}, folder) {
  const file = input.file_path ?? input.notebook_path ?? input.path;
  const shown = file ? (path.isAbsolute(file) && file.startsWith(folder) ? path.relative(folder, file) : file) : '';
  const detail = shown || input.command || input.pattern || input.query || input.url || input.description || input.text || input.reason || '';
  return { tool: name, detail: String(detail).slice(0, 200), file: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) ? shown : '' };
}

// The claude command's environment: everything but an API key, so it always uses the
// owner's own Claude login.
export function claudeEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

// Answers under way: conversation id → { child, stopped, tools }.
const running = new Map();
export const isAnswering = (id) => running.has(id);
// What the app's tools need for the answer under way in a conversation (mcp.js).
export const toolsFor = (conversationId) => running.get(conversationId)?.tools ?? { conversationId };

// Sends a message and starts the answer. send(event) gets each part as it arrives:
// { type: 'text', text }, { type: 'step', step }, { type: 'step_done', id, error },
// { type: 'card', card }, then { type: 'done', message }. Resolves with the finished
// answer. mcp: { url, secret } of the app's tools; context: { path, title } of the page
// the question was asked on.
export function sendMessage(db, id, text, { dataDir, command = DEFAULT_COMMAND, provider = 'claude', send = () => {}, mcp = null, context = null, notes = [], library = null, images = [] }) {
  let conversation = getConversation(db, id);
  if (!conversation) throw fail(404, 'There is no such conversation.');
  if (running.has(id)) throw fail(409, 'The assistant is still answering here. Stop it first.');
  const words = text.trim();
  addMessage(db, id, 'user', words, 'done', context);
  if (!conversation.title) db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(words.split('\n')[0].slice(0, 80), id);
  const answerId = addMessage(db, id, 'assistant', '', 'answering');
  const folder = path.join(dataDir, conversation.folder);
  fs.mkdirSync(folder, { recursive: true });
  const folderReal = fs.realpathSync(folder);
  // A conversation remembers the AI it was carried on with: Codex's thread is kept as codex:<id>.
  // Carried on with the other one, it starts afresh there, told what was said so far.
  const codexThread = conversation.session_id.startsWith('codex:') ? conversation.session_id.slice(6) : null;
  const sameAI = conversation.started && (provider === 'codex') === Boolean(codexThread);
  if (!sameAI && conversation.started) {
    db.prepare('UPDATE conversations SET started = 0, session_id = ? WHERE id = ?').run(randomUUID(), id);
    conversation = { ...conversation, started: false, session_id: db.prepare('SELECT session_id FROM conversations WHERE id = ?').get(id).session_id };
  }
  const earlier = sameAI ? [] : conversation.messages.filter((m) => m.text && m.state !== 'answering').slice(-12);

  let answer = '';
  const steps = [];
  const read = new Map();
  let saved = 0;
  const sourcesOf = () => {
    const linked = [...answer.matchAll(LINKED)].map((m) => findPage(db, m[1])).filter(Boolean);
    const all = new Map([...read, ...linked.map((p) => [p.id, p])]);
    return [...all.values()].map(({ id: pageId, kind, title, path: where }) => ({ id: pageId, kind, title, path: where }));
  };
  const save = (state) => {
    db.prepare('UPDATE chat_messages SET text = ?, steps = ?, sources = ?, state = ?, updated_at = ? WHERE id = ?')
      .run(answer, JSON.stringify(steps), JSON.stringify(sourcesOf()), state, now(), answerId);
    saved = Date.now();
  };
  // The app's tools, for the claude command: a config file only the app and it read.
  let mcpArgs = [];
  if (mcp) {
    const configDir = path.join(dataDir, 'assistant', '.mcp');
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const configFile = path.join(configDir, `${id}.json`);
    fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { app: {
      type: 'http', url: `${mcp.url}?conversation=${id}`, headers: { Authorization: `Bearer ${mcp.secret}` },
    }, ...(library ? { library } : {}) } }), { mode: 0o600 });
    // The Sovran Library (sovran-library.js), when the owner gave its key: read only, so allowed without asking.
    mcpArgs = ['--mcp-config', configFile, '--strict-mcp-config', '--allowedTools', library ? 'mcp__app,mcp__library' : 'mcp__app',
      '--permission-prompt-tool', 'mcp__app__approve_step'];
  }
  const asked = context ? `${words}\n\n(Asked on this page of the app: “${context.title || context.path}”, ${context.path}.)` : words;
  const noted = notes.length ? `${asked}\n\n${notes.map((n) => `(Note from the app: ${n})`).join('\n')}` : asked; // what it should know since last time, not shown as something the owner wrote
  const prompt = earlier.length
    ? `(Note from the app: this conversation began with the owner’s other assistant. What was said so far:)\n${earlier.map((m) => `${m.role === 'user' ? 'Owner' : 'Assistant'}: ${m.text.slice(0, 2000)}`).join('\n')}\n\n${noted}`
    : noted;

  const args = provider === 'codex' ? codexArgs(command, {
    instructions: guide(), sandbox: 'workspace-write', images,
    servers: { ...(mcp ? { app: { url: `${mcp.url}?conversation=${id}`, token: true } } : {}), ...(mcp && library ? { library: { url: library.url } } : {}) },
    resume: sameAI ? codexThread : null,
  }) : [
    ...command.slice(1), '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'acceptEdits', '--setting-sources', 'user', '--append-system-prompt', guide(), ...mcpArgs,
    // An allow-list of built-ins, by name (assistant/1): reading, finding, searching and writing its own
    // files. No shell, no web, no slash commands: the app's own tools come over MCP above.
    '--tools=Read,Glob,Grep,Write', '--disable-slash-commands',
    '--disallowedTools', ...NEVER_TOOLS,
    ...(conversation.started ? ['--resume', conversation.session_id] : ['--session-id', conversation.session_id]),
  ];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command[0], args, { cwd: folder, env: provider === 'codex' ? codexEnv(mcp?.secret) : claudeEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      answer = 'The assistant could not start.';
      save('failed');
      resolve(getMessage(db, answerId));
      return;
    }
    const run = {
      child,
      stopped: false,
      tools: {
        conversationId: id,
        messageId: answerId,
        folder: folderReal,
        read: (page) => {
          read.set(page.id, page);
          // The step that read it names the page, not its id.
          const step = steps.findLast((s) => s.tool === 'mcp__app__read_note' && !s.detail);
          if (step) step.detail = page.title;
        },
        card: (card) => send({ type: 'card', card }),
        cancel: () => cancelWaits(db, id),
      },
    };
    running.set(id, run);
    let result = null;
    let problem = '';
    let buffer = '';
    const handleEvent = (event) => {
      if (event.type === 'system' && event.subtype === 'init') {
        if (provider === 'codex') db.prepare('UPDATE conversations SET started = 1, session_id = ? WHERE id = ?').run(`codex:${event.session_id}`, id);
        else db.prepare('UPDATE conversations SET started = 1 WHERE id = ?').run(id);
      } else if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
        const delta = event.event.delta.text;
        if (answer && !answer.endsWith('\n') && steps.length && steps.at(-1).after === answer.length) answer += '\n\n';
        answer += delta;
        send({ type: 'text', text: delta });
        if (Date.now() - saved > SAVE_EVERY_MS) save('answering');
      } else if (event.type === 'assistant') {
        for (const part of event.message?.content ?? []) {
          if (part.type !== 'tool_use' || steps.some((s) => s.id === part.id)) continue;
          const step = { id: part.id, ...describe(part.name, part.input, folderReal), state: 'working', after: answer.length };
          steps.push(step);
          send({ type: 'step', step });
        }
      } else if (event.type === 'user') {
        for (const part of event.message?.content ?? []) {
          if (part.type !== 'tool_result') continue;
          const step = steps.find((s) => s.id === part.tool_use_id);
          if (!step) continue;
          step.state = part.is_error ? 'failed' : 'done';
          // A step the floor stops inside Claude Code (its disallowed tools) is logged too.
          if (part.is_error && step.tool === 'Bash') {
            const judged = judgeStep('Bash', { command: step.detail }, { folder: folderReal });
            if (judged.verdict === 'never') logActivity(db, { kind: 'refused', what: `Step: ${judged.what}`, conversation_id: id });
          }
          send({ type: 'step_done', id: step.id, error: Boolean(part.is_error) });
        }
      } else if (event.type === 'result') {
        result = event;
      }
    };
    const reader = lineReader(provider, handleEvent);
    const handle = (line) => reader.line(line);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) handle(line);
    });
    child.stderr.on('data', (chunk) => { if (problem.length < 2000) problem += chunk; });
    child.on('error', (err) => {
      problem = err.code === 'ENOENT' ? `The ${provider === 'codex' ? 'codex' : 'claude'} command is not installed on this computer.` : err.message;
    });
    child.on('close', (code) => {
      if (buffer.trim()) handle(buffer);
      running.delete(id);
      let state = 'done';
      if (run.stopped) state = 'stopped';
      else if (!result || result.is_error || (code !== 0 && code !== null)) {
        state = 'failed';
        const reason = (result?.is_error && result.result) || reader.state.problem || problem.trim().split('\n').filter((l) => !/^WARNING|^\d{4}-\d\d-\d\dT/.test(l))[0] || `It stopped (${code}).`;
        answer = answer ? `${answer}\n\n(${reason})` : `The assistant couldn't answer: ${reason}`;
      }
      if (!answer && result?.result) answer = result.result;
      for (const step of steps) if (step.state === 'working') step.state = state === 'done' ? 'done' : 'stopped';
      save(state);
      const finished = getMessage(db, answerId);
      send({ type: 'done', message: finished });
      resolve(finished);
    });
    child.stdin.on('error', () => {}); // a command that exits at once: nothing more to say
    child.stdin.end(prompt);
  });
}

// Stop: ends the answer under way (what came so far is kept).
export function stopAnswer(id) {
  const run = running.get(id);
  if (!run) return false;
  run.stopped = true;
  run.tools.cancel?.();
  run.child.kill('SIGINT');
  setTimeout(() => { if (running.get(id) === run) run.child.kill('SIGTERM'); }, 2000).unref();
  return true;
}

// When the app stops: every answer is stopped and kept, then it may close.
export async function stopAll({ wait = 3000 } = {}) {
  for (const id of running.keys()) stopAnswer(id);
  const until = Date.now() + wait;
  while (running.size && Date.now() < until) await new Promise((done) => setTimeout(done, 50));
}
