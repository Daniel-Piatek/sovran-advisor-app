// What your assistant may do alone, and what waits for you (assistant/4). One switch per
// kind of action, Does it alone or Asks first, kept in Settings and read at the moment of
// each step, so it holds in every chat. What asks becomes an approval card in the chat,
// and nothing happens until you answer. Below the switches, a floor that no switch moves:
// deleting always asks, and a few things never run at all (sudo, wiping a disk, the
// system's passwords and keychain). The floor is given to every session as disallowed
// tools and checked again here. Every switch you change is kept in the activity log.

import { randomUUID } from 'node:crypto';
import { moduleOn } from './modules.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

export const MODES = ['alone', 'ask'];
export const PERMISSIONS = [
  { key: 'add_task', name: 'Add a task', mode: 'ask' },
  { key: 'add_note', name: 'Add a note', mode: 'ask' },
  { key: 'append_to_journal', name: 'Write in your journal', mode: 'alone' },
  { key: 'log_interaction', name: 'Log an interaction (a call, a coffee, a message)', mode: 'ask', module: 'people-plus' },
  { key: 'change', name: 'Change a note or a task (edit, tick, move)', mode: 'ask' },
  { key: 'outside', name: 'Work outside its own folder (other files, commands, the web)', mode: 'ask' },
];

// Never, whatever is switched on: as Claude Code's own disallowed tools (they beat every
// mode), and as patterns this app refuses again when a step reaches it.
export const NEVER_TOOLS = [
  'Bash(sudo:*)', 'Bash(su:*)', 'Bash(doas:*)', 'Bash(diskutil erase:*)', 'Bash(diskutil eraseDisk:*)', 'Bash(mkfs:*)',
  'Bash(dd:*)', 'Bash(security:*)', 'Bash(osascript:*)',
];
const NEVER = [
  /(^|[;&|`$(]\s*)(sudo|su|doas)\b/, /\bdiskutil\s+(erase|zero|secureErase|partitionDisk)/i, /\bmkfs\b/, /(^|[;&|]\s*)dd\s/,
  /\bsecurity\s+(find|dump|export|unlock|delete)/, /\bosascript\b/, /\brm\s+-[a-z]*r[a-z]*f?\s+\/(\s|$)/,
  /\b(1password|op\s+(item|read)|bitwarden|bw\s+get|keepass)/i,
];
// Deleting always asks, even when work outside the folder may run alone.
const DELETES = /(^|[;&|]\s*)(rm|rmdir|unlink|trash|shred)\b|\bfind\b.*-delete\b|\bgit\s+(clean|branch\s+-D|reset\s+--hard)\b/;

const KEY = (key) => `assistant.${key}`;

export function getPermissions(db) {
  const stored = Object.fromEntries(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'assistant.%' AND deleted_at IS NULL").all()
    .map((row) => [row.key, JSON.parse(row.value)]));
  // A permission that belongs to a module is there while the module is on.
  return PERMISSIONS.filter((p) => !p.module || moduleOn(db, p.module))
    .map(({ module, ...p }) => ({ ...p, mode: MODES.includes(stored[KEY(p.key)]) ? stored[KEY(p.key)] : p.mode, default: p.mode }));
}

export const modeOf = (db, key) => getPermissions(db).find((p) => p.key === key)?.mode ?? 'ask';

export function setPermission(db, key, mode) {
  const permission = PERMISSIONS.find((p) => p.key === key);
  if (!permission) throw fail(400, `There is no permission called ${key}.`);
  if (!MODES.includes(mode)) throw fail(400, 'A permission is alone or ask.');
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, KEY(key), JSON.stringify(mode));
  logActivity(db, { kind: 'switch', what: `${permission.name}: ${mode === 'alone' ? 'Does it alone' : 'Asks first'}` });
  return getPermissions(db);
}

// What a step of Claude Code's own would do, in a few words, and how it is decided:
// never (the floor), always asks (deleting), or as the switch says.
export function judgeStep(toolName, input = {}, { folder }) {
  const command = String(input.command ?? '');
  const file = String(input.file_path ?? input.notebook_path ?? input.path ?? '');
  const inside = file && folder && (file === folder || file.startsWith(`${folder}/`));
  let what;
  if (toolName === 'Bash') what = `Run a command: ${command.slice(0, 300)}`;
  else if (['Read', 'Glob', 'Grep', 'LS'].includes(toolName)) what = `Read ${inside ? 'in its folder' : 'outside its folder'}: ${file || input.pattern || ''}`;
  else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) what = `Change a file ${inside ? 'in its folder' : 'outside its folder'}: ${file}`;
  else if (['WebFetch', 'WebSearch'].includes(toolName)) what = `Use the web: ${input.url ?? input.query ?? ''}`;
  else what = `Use ${toolName}`;
  if (toolName === 'Bash' && NEVER.some((pattern) => pattern.test(command))) return { what, verdict: 'never' };
  if (/password|passcode|keychain/i.test(`${toolName} ${command}`)) return { what, verdict: 'never' };
  if (toolName === 'Bash' && DELETES.test(command)) return { what, verdict: 'ask', always: true };
  return { what, verdict: 'switch' };
}

// ---- Always allow (assistant/4) ----
// "Always allow" on a step's card lets that kind of step through from then on: reading or
// changing files in one folder, one plain command word, one web site. The kinds are listed in
// Settings, each with Remove. Never for the floor, never for deleting, and not for a command
// that could be anything (a shell, an interpreter, a pipe or a chain).
const RULES = 'assistant.allow';
const ANYTHING = new Set(['sh', 'bash', 'zsh', 'fish', 'python', 'python3', 'node', 'perl', 'ruby', 'php', 'osascript', 'curl', 'wget', 'ssh', 'scp',
  'rsync', 'env', 'xargs', 'eval', 'exec', 'open', 'nohup', 'sudo', 'su', 'doas', 'npm', 'npx', 'pip', 'brew', 'git']);
const dirOf = (file) => file.slice(0, Math.max(file.lastIndexOf('/'), 1));

// The kind a step belongs to, or null when it can't be allowed for good.
export function ruleOf(toolName, input = {}, { folder } = {}) {
  const command = String(input.command ?? '');
  const file = String(input.file_path ?? input.notebook_path ?? input.path ?? '');
  const inside = file && folder && (file === folder || file.startsWith(`${folder}/`));
  if (['Read', 'Glob', 'Grep', 'LS'].includes(toolName) && file.startsWith('/') && !inside) return { rule: `read:${dirOf(file)}`, label: `Read files in ${dirOf(file)}` };
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName) && file.startsWith('/') && !inside) return { rule: `write:${dirOf(file)}`, label: `Change files in ${dirOf(file)}` };
  if (toolName === 'Bash') {
    if (/[;&|`$()<>\n\\]/.test(command)) return null;
    const word = command.trim().split(/\s+/)[0]?.split('/').pop();
    if (!word || ANYTHING.has(word) || !/^[\w.-]+$/.test(word)) return null;
    return { rule: `command:${word}`, label: `Run “${word}” commands` };
  }
  if (['WebFetch', 'WebSearch'].includes(toolName) && input.url) {
    try { const host = new URL(input.url).hostname; return host ? { rule: `web:${host}`, label: `Open pages on ${host}` } : null; } catch { return null; }
  }
  return null;
}

export function allowedRules(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(RULES);
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}
const saveRules = (db, rules) => {
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, RULES, JSON.stringify(rules));
};
export const isAllowed = (db, rule) => allowedRules(db).some((r) => r.rule === rule);
export function allowRule(db, { rule, label }) {
  if (isAllowed(db, rule)) return allowedRules(db);
  saveRules(db, [...allowedRules(db), { rule, label }]);
  logActivity(db, { kind: 'switch', what: `Always allowed: ${label}` });
  return allowedRules(db);
}
export function removeRule(db, rule) {
  const found = allowedRules(db).find((r) => r.rule === rule);
  if (!found) throw fail(404, 'That is not on the list.');
  saveRules(db, allowedRules(db).filter((r) => r.rule !== rule));
  logActivity(db, { kind: 'switch', what: `No longer always allowed: ${found.label}` });
  return allowedRules(db);
}

// ---- The activity log ----

export function logActivity(db, { kind, what, conversation_id = null }) {
  const time = now();
  db.prepare('INSERT INTO assistant_activity (id, created_at, updated_at, origin, kind, what, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), time, time, kind === 'switch' ? 'typed' : 'assistant', kind, what.slice(0, 500), conversation_id);
}

export const recentActivity = (db, limit = 40) => db.prepare(`SELECT id, created_at, kind, what, conversation_id FROM assistant_activity
  WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(limit).map((row) => ({ ...row }));
