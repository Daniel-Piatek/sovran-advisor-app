// Tidying a phone note (Phone capture; the owner's wish, 2026-11-14). A phone's keyboard microphone writes words
// without commas or full stops, and spells the course's own words its own way. When a phone note comes in:
//   1. the glossary's fixes are applied at once: each student's own (Settings › Dictation) and the Sovran glossary
//      kept by the course (sovran-glossary.json), so "Sovereign Advisor" is written "Sovran Advisor";
//   2. then, in the background, the student's own assistant (the AI chosen in Settings, run here with no tools at
//      all) adds punctuation and capital letters. Its answer is kept only when it changed punctuation, capitals and
//      at most a few words; otherwise the words stay as they were. What was said on the phone is always kept
//      (capture_tidy.spoken) and the Inbox shows it under "As you said it".
// A note you have edited, sorted or deleted in the meantime is left alone.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { claudeEnv, DEFAULT_COMMAND } from './assistant.js';
import { codexArgs, codexEnv, lineReader } from './codex.js';
import { fixes, keyterms, applyFixes } from './glossary.js';

const MAX_TRIES = 3;
const READ_FOR_MS = 2 * 60_000;
const now = () => new Date().toISOString();
const wordsOf = (text) => String(text).toLowerCase().normalize('NFKC').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]+/gu, '')).filter(Boolean);

// The glossary's fixes on the phone's words: { fixed, spoken }.
export function fixPhoneWords(db, spoken) {
  return { spoken, fixed: applyFixes(spoken, fixes(db)).text };
}

// A phone note waits for its punctuation.
export function rememberSpoken(db, captureId, { spoken, fixed }) {
  const time = now();
  db.prepare(`INSERT OR IGNORE INTO capture_tidy (id, created_at, updated_at, capture_id, spoken, fixed, state)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), time, time, captureId, spoken, fixed, 'waiting');
}

// How many words differ between two texts (a word-level edit distance, punctuation and capitals ignored).
export function wordsChanged(a, b) {
  const x = wordsOf(a);
  const y = wordsOf(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length];
}

// The assistant's answer, checked: the same words (a glossary spelling or two, at most one word in ten), on its own.
export function readTidy(answer, fixed) {
  const text = String(answer ?? '').trim().replace(/^```[a-z]*\n?|\n?```$/g, '').replace(/^["“]+|["”]+$/g, '').trim();
  if (!text || text.length > fixed.length * 1.3 + 20) return '';
  const allowed = Math.max(2, Math.floor(wordsOf(fixed).length / 10));
  return wordsChanged(fixed, text) <= allowed ? text : '';
}

export const tidyPrompt = (text, terms) => [
  'This was dictated on a phone. Add punctuation, capital letters and paragraph breaks where the speaker paused for a new thought.',
  'Keep every word exactly as it is, in the same order. Do not add, drop, rephrase or answer anything.',
  'The only words you may change are misheard spellings of these names and terms, written as given:',
  terms.length ? terms.join(', ') : '(none)',
  'Answer with the punctuated text alone, nothing else.',
  'The dictation:',
  '"""',
  text,
  '"""',
].join('\n');

export function startTidier({ db, dataDir, command = DEFAULT_COMMAND, ai = null, every = 5 * 60_000, onDone = () => {} }) {
  const folder = path.join(dataDir, 'assistant', 'tidy');
  let busy = false;
  let stopped = false;
  let child = null;

  const settle = (row, state, body) => {
    db.exec('BEGIN');
    try {
      if (body) db.prepare("UPDATE captures SET body = ?, updated_at = ? WHERE id = ? AND body = ? AND state = 'waiting' AND deleted_at IS NULL").run(body, now(), row.capture_id, row.fixed);
      db.prepare('UPDATE capture_tidy SET state = ?, updated_at = ? WHERE id = ?').run(state, now(), row.id);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  };

  function tidyOne(row) {
    return new Promise((resolve) => {
      fs.mkdirSync(folder, { recursive: true });
      const { provider, command: run } = ai ? ai() : { provider: 'claude', command };
      const args = provider === 'codex' ? codexArgs(run) : [...run.slice(1), '-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user', '--tools=', '--disable-slash-commands',
        '--strict-mcp-config', '--disallowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
      let out = '';
      let result = null;
      const reader = lineReader(provider, (event) => { if (event.type === 'result') result = event; });
      try {
        child = spawn(run[0], args, { cwd: folder, env: provider === 'codex' ? codexEnv() : claudeEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
      } catch { resolve(false); return; }
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
          if (!result || result.is_error) return resolve(false);
          const tidied = readTidy(result.result, row.fixed);
          settle(row, tidied ? 'done' : 'kept', tidied && tidied !== row.fixed ? tidied : '');
          resolve(true);
        } catch { resolve(false); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(tidyPrompt(row.fixed, keyterms(db)));
    });
  }

  async function catchUp() {
    if (busy || stopped) return;
    busy = true;
    try {
      // Only a note still as it came in: edited, sorted or deleted, it is left as it is.
      const waiting = db.prepare(`SELECT t.id, t.capture_id, t.fixed, t.tries FROM capture_tidy t JOIN captures c ON c.id = t.capture_id
        WHERE t.state = 'waiting' AND c.deleted_at IS NULL AND c.state = 'waiting' AND c.body = t.fixed ORDER BY t.created_at LIMIT 20`).all();
      db.prepare(`UPDATE capture_tidy SET state = 'kept', updated_at = ? WHERE state = 'waiting' AND capture_id IN
        (SELECT id FROM captures c WHERE c.deleted_at IS NOT NULL OR c.state <> 'waiting' OR c.body <> capture_tidy.fixed)`).run(now());
      let any = false;
      for (const row of waiting) {
        if (stopped) break;
        if (row.tries >= MAX_TRIES) { settle(row, 'kept', ''); continue; }
        db.prepare('UPDATE capture_tidy SET tries = tries + 1, updated_at = ? WHERE id = ?').run(now(), row.id);
        if (await tidyOne(row)) any = true;
      }
      if (any) onDone();
    } catch { /* the app is closing */ }
    busy = false;
  }

  const timer = every ? setInterval(catchUp, every) : null;
  timer?.unref?.();
  return {
    catchUp,
    soon: () => setTimeout(catchUp, 200).unref(),
    stop: () => { stopped = true; clearInterval(timer); child?.kill('SIGTERM'); },
  };
}

// What the Inbox shows of a capture's tidy-up: what was said, when the capture's words now differ from it.
export function spokenOf(db, captureId) {
  const row = db.prepare('SELECT spoken, state FROM capture_tidy WHERE capture_id = ?').get(captureId);
  return row ? { spoken: row.spoken, tidy: row.state } : null;
}
