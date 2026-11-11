// Your assistant suggests where a capture goes (assistant/3). After a capture is saved,
// the claude command reads it in the background, one at a time: a short title, a one-line
// summary, the notes and people it connects to (it looks those up first, with the app's
// read-only tools), then what it should become (a task with a day, a note, the journal,
// or let it go), which home in My Life it belongs to, and one line of why. The suggestion
// sits on the capture in the Inbox; nothing moves until you accept it (Enter). Saving
// never waits for it: a capture is kept at once, and if the assistant isn't available it
// keeps its raw words and is read later (on the next start, at most three tries).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getCapture, sortCapture, letGo, updateCapture, homeOf } from './captures.js';
import { findPage } from './assistant-tools.js';
import { localDay } from './entries.js';
import { moduleOn } from './modules.js';
import { claudeEnv, DEFAULT_COMMAND } from './assistant.js';
import { codexArgs, codexEnv, lineReader } from './codex.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const isDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text);

export const KINDS = ['task', 'note', 'journal', 'let_go'];
export const READER = 'inbox';     // the tools' name for this reader (read-only, mcp.js)
const MAX_TRIES = 3;
const READ_FOR_MS = 3 * 60_000;
const COLUMNS = 'capture_id, state, title, summary, kind, day, home_id, connects, why, tries, read_at';

export function suggestionOf(db, captureId) {
  const row = db.prepare(`SELECT ${COLUMNS} FROM capture_suggestions WHERE capture_id = ?`).get(captureId);
  if (!row) return null;
  const home = row.home_id ? db.prepare('SELECT id, kind, title FROM life_items WHERE id = ? AND deleted_at IS NULL').get(row.home_id) : null;
  return { ...row, connects: JSON.parse(row.connects), home: home ? { ...home } : null };
}

// Read it again: after its words changed.
export function forgetSuggestion(db, captureId) {
  db.prepare('DELETE FROM capture_suggestions WHERE capture_id = ?').run(captureId);
}

function keep(db, captureId, fields) {
  const time = now();
  const row = { state: 'reading', title: '', summary: '', kind: '', day: '', home_id: null, connects: '[]', why: '', ...fields };
  db.prepare(`INSERT INTO capture_suggestions (id, created_at, updated_at, origin, capture_id, state, title, summary, kind, day, home_id, connects, why, tries, read_at)
      VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (capture_id) DO UPDATE SET updated_at = excluded.updated_at, state = excluded.state, title = excluded.title,
      summary = excluded.summary, kind = excluded.kind, day = excluded.day, home_id = excluded.home_id,
      connects = excluded.connects, why = excluded.why, tries = excluded.tries, read_at = excluded.read_at`)
    .run(captureId, time, time, captureId, row.state, row.title, row.summary, row.kind, row.day, row.home_id, row.connects, row.why,
      row.tries ?? 0, row.read_at ?? null);
}

// What the assistant is asked, with what it needs to choose a home.
function promptFor(db, capture) {
  const homes = db.prepare(`SELECT id, kind, title FROM life_items WHERE deleted_at IS NULL AND state = 'active'
    ORDER BY kind = 'project' DESC, kind = 'goal' DESC, title COLLATE NOCASE LIMIT 80`).all()
    .map((h) => `- ${h.id} (${h.kind.replace('_', ' ')}) ${h.title}`).join('\n') || '(none yet)';
  return [
    'You sort one capture from the owner’s Inbox. Do not change anything: only read, then answer.',
    `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}, ${localDay()}.`,
    'First look up what it connects to with mcp__app__search_notes (people, notes, projects it names). Then decide.',
    'Answer with one JSON object and nothing else:',
    '{"title": "a short title", "summary": "one line", "kind": "task" | "note" | "journal" | "let_go",',
    ' "day": "YYYY-MM-DD for a task that has a day, else empty", "home_id": "an id from the homes below, or empty",',
    ' "connects": ["ids of the notes, entries or people it connects to"], "why": "one short line of why"}',
    'A task is something to do; a note is something to keep and think with; the journal is how a day went; let it go when it needs nothing.',
    ...(capture.world === 'outer' && moduleOn(db, 'tasks-plus')
      ? ['This capture is from the Outer World: something someone else made (an article, a newsletter, a link). Suggest a note to keep, or let it go; do not make it a task of the owner’s.'] : []),
    'Homes in My Life:',
    homes,
    'The capture:',
    '"""',
    capture.body,
    '"""',
  ].join('\n');
}

// The answer, checked: only what fits is kept.
// world: the capture's own. Something from the Outer World (what someone else made) is never suggested as a task of the
// owner's (Tasks in depth 7): it is a note to keep, or let go.
export function readAnswer(db, text, { world = 'inner' } = {}) {
  const match = /\{[\s\S]*\}/.exec(text ?? '');
  if (!match) return null;
  let answer;
  try { answer = JSON.parse(match[0]); } catch { return null; }
  if (!KINDS.includes(answer.kind)) return null;
  if (world === 'outer' && moduleOn(db, 'tasks-plus') && answer.kind === 'task') answer = { ...answer, kind: 'note', day: '' };
  const home = typeof answer.home_id === 'string' && answer.home_id
    ? db.prepare("SELECT id FROM life_items WHERE id = ? AND deleted_at IS NULL AND state = 'active'").get(answer.home_id) : null;
  const connects = (Array.isArray(answer.connects) ? answer.connects : []).filter((id) => typeof id === 'string').slice(0, 5)
    .map((id) => findPage(db, id)).filter(Boolean).map(({ id, kind, title, path: where }) => ({ id, kind, title, path: where }));
  return {
    title: String(answer.title ?? '').trim().slice(0, 120),
    summary: String(answer.summary ?? '').trim().slice(0, 300),
    kind: answer.kind,
    day: answer.kind === 'task' && isDay(String(answer.day ?? '')) ? answer.day : '',
    home_id: answer.kind === 'task' || answer.kind === 'note' ? home?.id ?? null : null,
    connects: JSON.stringify(connects),
    why: String(answer.why ?? '').trim().slice(0, 200),
  };
}

// The reader: one capture at a time, in the background.
export function startReader({ db, dataDir, command = DEFAULT_COMMAND, ai = null, mcp, quietMs = 3000 }) {
  const queue = [];
  const later = new Map(); // capture id → timer, while its words are still being typed
  let busy = false;
  let stopped = false;
  let child = null;
  const folder = path.join(dataDir, 'assistant', READER);

  function readOne(captureId) {
    return new Promise((resolve) => {
      const capture = getCapture(db, captureId);
      if (!capture || capture.state !== 'waiting') { resolve(); return; }
      const before = suggestionOf(db, captureId);
      const tries = (before?.tries ?? 0) + 1;
      keep(db, captureId, { state: 'reading', tries });
      fs.mkdirSync(folder, { recursive: true });
      const configDir = path.join(dataDir, 'assistant', '.mcp');
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      const configFile = path.join(configDir, `${READER}.json`);
      fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { app: {
        type: 'http', url: `${mcp().url}?conversation=${READER}`, headers: { Authorization: `Bearer ${mcp().secret}` },
      } } }), { mode: 0o600 });
      // The AI chosen in Settings (ai.js): Claude Code, or ChatGPT's Codex with the same two tools.
      const { provider, command: run } = ai ? ai() : { provider: 'claude', command };
      const args = provider === 'codex' ? codexArgs(run, {
        servers: { app: { url: `${mcp().url}?conversation=${READER}`, token: true } }, tools: { app: ['search_notes', 'read_note'] },
      }) : [...run.slice(1), '-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user', '--tools=Read,Glob,Grep', '--disable-slash-commands',
        '--mcp-config', configFile, '--strict-mcp-config', '--allowedTools', 'mcp__app__search_notes', 'mcp__app__read_note'];
      let out = '';
      let result = null;
      const reader = lineReader(provider, (event) => { if (event.type === 'result') result = event; });
      try {
        child = spawn(run[0], args, { cwd: folder, env: provider === 'codex' ? codexEnv(mcp().secret) : claudeEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
      } catch {
        keep(db, captureId, { state: 'failed', tries });
        resolve();
        return;
      }
      const timer = setTimeout(() => child?.kill('SIGTERM'), READ_FOR_MS);
      child.stdout.on('data', (chunk) => {
        out += chunk;
        const lines = out.split('\n');
        out = lines.pop();
        for (const line of lines) reader.line(line);
      });
      child.on('error', () => {});
      child.on('close', () => {
        clearTimeout(timer);
        child = null;
        try {
          const read = result && !result.is_error ? readAnswer(db, result.result, { world: capture.world }) : null;
          const still = getCapture(db, captureId);
          if (!still || still.body !== capture.body) { /* let go, or changed meanwhile: read again */ } else if (read) {
            keep(db, captureId, { ...read, state: 'ready', tries, read_at: now() });
            // Its home starts at the one suggested, unless one was chosen already.
            if (read.home_id && !still.home_id) updateCapture(db, captureId, { home_id: read.home_id });
          } else keep(db, captureId, { state: 'failed', tries });
        } catch { /* the app is closing */ }
        resolve();
      });
      child.stdin.on('error', () => {});
      child.stdin.end(promptFor(db, capture));
    });
  }

  async function work() {
    if (busy) return;
    busy = true;
    while (queue.length && !stopped) await readOne(queue.shift());
    busy = false;
  }

  const add = (captureId) => {
    if (stopped || queue.includes(captureId)) return;
    queue.push(captureId);
    work();
  };

  return {
    // A capture just saved: read it now. Changed: read it once the typing has paused.
    read: (captureId, { quiet = false } = {}) => {
      forgetSuggestion(db, captureId);
      clearTimeout(later.get(captureId));
      if (!quiet) { add(captureId); return; }
      later.set(captureId, setTimeout(() => { later.delete(captureId); add(captureId); }, quietMs));
    },
    // Every capture still waiting with nothing read yet, or not read after a failure.
    catchUp: () => {
      const waiting = db.prepare(`SELECT c.id FROM captures c LEFT JOIN capture_suggestions s ON s.capture_id = c.id
        WHERE c.state = 'waiting' AND c.deleted_at IS NULL AND (s.capture_id IS NULL OR s.state = 'reading' OR (s.state = 'failed' AND s.tries < ?))
        ORDER BY c.captured_at`).all(MAX_TRIES);
      for (const { id } of waiting) add(id);
    },
    idle: async () => { while (busy || queue.length) await new Promise((done) => setTimeout(done, 20)); },
    stop: () => { stopped = true; for (const timer of later.values()) clearTimeout(timer); child?.kill('SIGTERM'); },
  };
}

// Accept: the capture becomes what was suggested (as if you had chosen it), with its home.
export function acceptSuggestion(db, captureId) {
  const suggestion = suggestionOf(db, captureId);
  if (!suggestion || suggestion.state !== 'ready') throw fail(409, 'There is no suggestion to accept yet.');
  const capture = getCapture(db, captureId);
  if (!capture || capture.state !== 'waiting') throw fail(409, 'That capture is not waiting any more.');
  if (suggestion.kind === 'let_go') return { capture: letGo(db, captureId), made: null, kind: 'let_go' };
  const home = homeOf(db, capture); // the one chosen in the Inbox, which started as the suggested one
  if (suggestion.kind === 'task') {
    const text = suggestion.title || capture.body.split('\n').find((line) => line.trim())?.trim() || capture.body.trim();
    return { ...sortCapture(db, captureId, { to: 'task', task: { text: text.slice(0, 500), due: suggestion.day, home_id: home?.id ?? null } }), kind: 'task' };
  }
  if (suggestion.kind === 'note') {
    return { ...sortCapture(db, captureId, { to: 'note' }), kind: 'note' };
  }
  return { ...sortCapture(db, captureId, { to: 'journal' }), kind: 'journal' };
}
