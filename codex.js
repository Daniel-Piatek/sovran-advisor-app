// ChatGPT as the assistant (ai.js): OpenAI's Codex program on this computer, signed in with the
// owner's own ChatGPT plan. The app starts `codex exec --json` where it would start `claude -p`,
// and turns what Codex prints (one JSON event a line) into the same events Claude Code prints,
// so the rest of the app reads both alike (assistant.js, suggestions.js, short-titles.js).
//
// Kept as close as Codex allows to how Claude is kept in the app (assistant/1):
// - no shell, no web search, none of the owner's ChatGPT apps or plugins: its tools are the
//   app's own (over MCP, with the app's secret in an environment variable only it reads) and,
//   with a key, the Sovran Library;
// - it may write only in its own conversation's folder (workspace-write), or nowhere (read-only);
// - the owner's own Codex settings (config.toml) are left out, so their other servers never come in;
// - never an API key: their ChatGPT sign-in.
// Codex gives an answer whole, not word by word, so it appears when it is ready.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CODEX_COMMAND = ['codex'];
// The copy of Codex that comes inside OpenAI's ChatGPT app for the Mac (2026-11-11): a student who
// has the ChatGPT app needs no Terminal or Node.js install for it. Codex on the PATH comes first.
export const CHATGPT_APP_CODEX = 'ChatGPT.app/Contents/Resources/codex-cli/bin/codex';

const runnable = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };

// Which codex to start: `codex` when it is on the PATH (as installed with npm or Homebrew), else on a
// Mac the one inside the ChatGPT app (in /Applications or the owner's own Applications folder), else
// plain `codex`, which then reads as "not set up yet". Looked up each time, so installing either one
// works without restarting the app.
export function findCodex({ env = process.env, platform = process.platform, home = os.homedir(), isRunnable = runnable } = {}) {
  if (platform === 'win32') return DEFAULT_CODEX_COMMAND;
  const onPath = String(env.PATH ?? '').split(path.delimiter).filter(Boolean).some((dir) => isRunnable(path.join(dir, 'codex')));
  if (onPath) return DEFAULT_CODEX_COMMAND;
  if (platform === 'darwin') {
    const inApp = [path.join('/Applications', CHATGPT_APP_CODEX), path.join(home, 'Applications', CHATGPT_APP_CODEX)].find(isRunnable);
    if (inApp) return [inApp];
  }
  return DEFAULT_CODEX_COMMAND;
}
export const TOKEN_ENV = 'SOVRAN_APP_TOKEN';

// Parts of Codex switched off for the app, where this version of Codex has them (an unknown
// name stops Codex, so only those it lists are named).
const OFF = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'browser_use', 'browser_use_external',
  'in_app_browser', 'computer_use', 'image_generation', 'multi_agent', 'memories', 'hooks', 'tool_suggest', 'goals',
  'skill_search', 'standalone_web_search'];
const features = new Map();
export function featuresOff(command) {
  const key = JSON.stringify(command);
  if (!features.has(key)) {
    let known = [];
    try {
      const listed = spawnSync(command[0], [...command.slice(1), 'features', 'list'], { timeout: 10_000, encoding: 'utf8', shell: process.platform === 'win32' });
      known = String(listed.stdout ?? '').split('\n').map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
    } catch { /* an older Codex: nothing named */ }
    features.set(key, OFF.filter((name) => known.includes(name)));
  }
  return features.get(key);
}

const toml = (value) => JSON.stringify(value); // a JSON string or list is a TOML one too

// The arguments for one turn. servers: { name: { url, token? } } (token: the app's secret, sent
// from the environment); resume: the Codex thread to carry on; images: files to attach.
export function codexArgs(command, { instructions = '', servers = {}, sandbox = 'read-only', resume = null, images = [], tools = {} } = {}) {
  const config = [
    'approval_policy="never"', // nothing to ask: what it may do is set here, and changes wait on the app's cards
    'web_search="disabled"',
    ...(instructions ? [`developer_instructions=${toml(instructions)}`] : []),
  ];
  for (const [name, server] of Object.entries(servers)) {
    config.push(`mcp_servers.${name}.url=${toml(server.url)}`);
    if (server.token) config.push(`mcp_servers.${name}.bearer_token_env_var=${toml(TOKEN_ENV)}`);
    config.push(`mcp_servers.${name}.default_tools_approval_mode="approve"`);
    if (tools[name]) config.push(`mcp_servers.${name}.enabled_tools=${toml(tools[name])}`);
  }
  return [
    ...command.slice(1), 'exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--color', 'never',
    '--sandbox', sandbox,
    ...featuresOff(command).flatMap((name) => ['--disable', name]),
    ...config.flatMap((c) => ['-c', c]),
    ...(resume ? ['resume', resume] : []),
    ...images.flatMap((file) => ['--image', file]),
    '-', // the words come on stdin
  ];
}

// Codex's environment: never an OpenAI API key (their ChatGPT sign-in), plus the app's secret.
export function codexEnv(secret = '') {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  if (secret) env[TOKEN_ENV] = secret;
  else delete env[TOKEN_ENV];
  return env;
}

// One Codex event as Claude Code's events (none, one or more). state: {} kept across a turn.
export function asClaudeEvents(event, state) {
  const item = event.item ?? {};
  const step = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: item.id, name, input }] } });
  const done = (failed) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: item.id, is_error: failed }] } });
  const tool = () => {
    if (item.type === 'mcp_tool_call') return [`mcp__${item.server}__${item.tool}`, item.arguments ?? {}];
    if (item.type === 'command_execution') return ['Bash', { command: item.command }];
    if (item.type === 'web_search') return ['WebSearch', { query: item.query }];
    if (item.type === 'file_change') return ['Write', { file_path: item.changes?.[0]?.path ?? '' }];
    return null;
  };
  switch (event.type) {
    case 'thread.started':
      state.thread = event.thread_id;
      return [{ type: 'system', subtype: 'init', session_id: event.thread_id }];
    case 'item.started': {
      const named = tool();
      return named ? [step(...named)] : [];
    }
    case 'item.completed': {
      if (item.type === 'agent_message') {
        const text = String(item.text ?? '');
        if (!text) return [];
        const delta = state.text ? `\n\n${text}` : text;
        state.text = (state.text ?? '') + delta;
        return [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: delta } } }];
      }
      const named = tool();
      if (!named) return [];
      const failed = ['failed', 'declined'].includes(item.status) || Boolean(item.error)
        || (item.type === 'command_execution' && item.exit_code !== null && item.exit_code !== undefined && item.exit_code !== 0);
      return [step(...named), done(failed)]; // a step only seen finished (a file change) starts here
    }
    case 'turn.completed':
      return [{ type: 'result', subtype: 'success', is_error: false, result: state.text ?? '' }];
    case 'turn.failed':
      return [{ type: 'result', subtype: 'error', is_error: true, result: event.error?.message || 'ChatGPT stopped.' }];
    case 'error':
      state.problem = event.message; // often "Reconnecting…": only a reason if no answer comes
      return [];
    default:
      return [];
  }
}

// A line reader for either program: Claude Code's lines pass as they are, Codex's are turned.
export function lineReader(provider, handle) {
  const state = {};
  return {
    state,
    line(text) {
      let event;
      try { event = JSON.parse(text); } catch { return; }
      if (provider === 'codex') for (const e of asClaudeEvents(event, state)) handle(e);
      else handle(event);
    },
  };
}

// The model a Codex thread used: Codex does not print it, but keeps it in its own record of the
// thread ($CODEX_HOME/sessions/<year>/<month>/<day>/rollout-…-<thread>.jsonl). Looked for in the
// last two days' folders only; '' when it cannot be found.
export function codexModel(thread, { home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), when = new Date() } = {}) {
  try {
    const days = new Set();
    for (const back of [0, 1]) {
      const d = new Date(when.getTime() - back * 86_400_000);
      const pad = (n) => String(n).padStart(2, '0');
      days.add(path.join(String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
      days.add(path.join(String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())));
    }
    for (const day of days) {
      const folder = path.join(home, 'sessions', day);
      const file = fs.existsSync(folder) && fs.readdirSync(folder).find((f) => f.endsWith(`${thread}.jsonl`));
      if (!file) continue;
      let model = '';
      for (const line of fs.readFileSync(path.join(folder, file), 'utf8').split('\n')) {
        if (!line.includes('"turn_context"')) continue;
        try { const found = JSON.parse(line).payload?.model; if (typeof found === 'string') model = found; } catch { /* a line cut short */ }
      }
      return model.slice(0, 100);
    }
  } catch { /* not there: no name */ }
  return '';
}
