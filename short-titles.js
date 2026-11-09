// A few words for a long task (the owner's wish, 2026-10-26): a task of more than about ten
// words gets a short title written by the assistant in the background, kept with it
// (tasks.short_text). The Planner shows those words, and the whole text opens on a click.
// When a task's words change, its short title goes and is written again. The claude command
// runs here with no tools at all: it only reads the words it is given. If it is not
// available, the task simply shows its own words until a later try (each start of the app,
// and every few minutes, three tries a task at most).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { claudeEnv, DEFAULT_COMMAND } from './assistant.js';

export const LONG_WORDS = 10;      // more words than this: a long task
const MAX_TRIES = 3;
const READ_FOR_MS = 2 * 60_000;
const wordsIn = (text) => text.trim().split(/\s+/).filter(Boolean).length;
export const isLong = (text) => wordsIn(text) > LONG_WORDS;

// The words written back, checked: a few words on one line, never longer than the task.
export function readTitle(answer, text) {
  const line = String(answer ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const title = line.replace(/^["“”'`*\s]+|["“”'`*.\s]+$/g, '').replace(/^title:\s*/i, '').slice(0, 60);
  if (!title || wordsIn(title) > 7 || title.length >= text.length) return '';
  return title;
}

const prompt = (text) => [
  'Write a short title for this task from the owner’s list: two to five words, in the owner’s own language,',
  'saying what is to be done. Answer with the title alone, on one line, nothing else.',
  'The task:',
  '"""',
  text,
  '"""',
].join('\n');

export function startTitler({ db, dataDir, command = DEFAULT_COMMAND, every = 5 * 60_000 }) {
  const tries = new Map(); // task id → tries this run
  const folder = path.join(dataDir, 'assistant', 'titles');
  let busy = false;
  let stopped = false;
  let child = null;

  function writeOne(task) {
    return new Promise((resolve) => {
      fs.mkdirSync(folder, { recursive: true });
      const args = [...command.slice(1), '-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user', '--tools=', '--disable-slash-commands',
        '--strict-mcp-config', '--disallowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
      let out = '';
      let result = null;
      try {
        child = spawn(command[0], args, { cwd: folder, env: claudeEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
      } catch { resolve(); return; }
      const timer = setTimeout(() => child?.kill('SIGTERM'), READ_FOR_MS);
      child.stdout.on('data', (chunk) => {
        out += chunk;
        const lines = out.split('\n');
        out = lines.pop();
        for (const line of lines) { try { const e = JSON.parse(line); if (e.type === 'result') result = e; } catch { /* not JSON */ } }
      });
      child.on('error', () => {});
      child.on('close', () => {
        clearTimeout(timer);
        child = null;
        try {
          const title = result && !result.is_error ? readTitle(result.result, task.text) : '';
          // Kept only if the task still has the same words.
          if (title) db.prepare("UPDATE tasks SET short_text = ? WHERE id = ? AND text = ? AND short_text = ''").run(title, task.id, task.text);
        } catch { /* the app is closing */ }
        resolve();
      });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt(task.text));
    });
  }

  async function catchUp() {
    if (busy || stopped) return;
    busy = true;
    try {
      const waiting = db.prepare(`SELECT id, text FROM tasks WHERE deleted_at IS NULL AND done = 0 AND short_text = ''
        ORDER BY created_at DESC LIMIT 50`).all().filter((t) => isLong(t.text) && (tries.get(t.id) ?? 0) < MAX_TRIES);
      for (const task of waiting) {
        if (stopped) break;
        tries.set(task.id, (tries.get(task.id) ?? 0) + 1);
        await writeOne(task);
      }
    } catch { /* the app is closing */ }
    busy = false;
  }

  const timer = every ? setInterval(catchUp, every) : null;
  timer?.unref?.();
  return {
    catchUp,
    soon: () => setTimeout(catchUp, 500).unref(),
    stop: () => { stopped = true; clearInterval(timer); child?.kill('SIGTERM'); },
  };
}
