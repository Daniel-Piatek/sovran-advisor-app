// A stand-in for OpenAI's codex command, for tests: no test depends on a real AI model. It
// speaks the JSON lines of `codex exec --json` (thread.started, item.started/completed,
// turn.completed or turn.failed), keeps each thread in a file in its folder (so
// `exec resume <id>` remembers), reads the app's tools from its -c mcp_servers settings with
// the secret from the environment, and answers by rule:
//   --version / features list   as codex does
//   "…folder…"                  what is in the folder
//   "what did I ask"            the message before
//   "what did I write about X"  search_notes, then read_note, then quotes it with a link
//   "journal: X"                append_to_journal
//   "Write a short title for this task"   its first three words
//   "fail"                      turn.failed, as when not signed in
//   anything else               "You said: …"

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.0.0-fake'); process.exit(0); }
if (args[0] === 'features' && args[1] === 'list') {
  console.log('shell_tool                               stable             true');
  console.log('apps                                     stable             true');
  process.exit(0);
}
const configs = args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []));
const setting = (key) => {
  const found = configs.find((c) => c.startsWith(`${key}=`));
  return found ? JSON.parse(found.slice(key.length + 1)) : null;
};
const at = args.indexOf('resume');
const resumed = at >= 0 ? args[at + 1] : null;
const thread = resumed ?? randomUUID();
const memory = path.join(process.cwd(), `.fake-codex-${thread}.json`);
fs.writeFileSync(path.join(process.cwd(), '.fake-codex-last-run.json'), JSON.stringify({
  args, api_key: 'OPENAI_API_KEY' in process.env, token: Boolean(process.env.SOVRAN_APP_TOKEN),
}));

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

if (resumed && !fs.existsSync(memory)) {
  process.stderr.write(`Error: thread/resume failed: no rollout found for thread id ${resumed}\n`);
  process.exit(1);
}
out({ type: 'thread.started', thread_id: thread });
out({ type: 'turn.started' });
const asked = fs.existsSync(memory) ? JSON.parse(fs.readFileSync(memory, 'utf8')) : [];
fs.writeFileSync(memory, JSON.stringify([...asked, prompt]));

let items = 0;
const say = (text) => out({ type: 'item.completed', item: { id: `item_${items++}`, type: 'agent_message', text } });

const url = setting('mcp_servers.app.url');
let calls = 0;
async function tool(name, input) {
  const rpc = (method, params) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[setting('mcp_servers.app.bearer_token_env_var')]}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++calls, method, params }),
  }).then((r) => r.json());
  if (calls === 0) await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-codex', version: '1' } });
  const item = { id: `item_${items++}`, type: 'mcp_tool_call', server: 'app', tool: name, arguments: input, status: 'in_progress' };
  out({ type: 'item.started', item });
  const { result } = await rpc('tools/call', { name, arguments: input });
  out({ type: 'item.completed', item: { ...item, status: result.isError ? 'failed' : 'completed', result } });
  return result.isError ? null : (() => { try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; } })();
}

const words = prompt.trim().split('\n').at(-1);
const titleFor = /Write a short title for this task[\s\S]*?"""\n([\s\S]*?)\n"""/.exec(prompt);
const about = /what did I write about (?:the )?(.+?)\??$/im.exec(prompt);
const journal = /^journal:\s*(.+)$/im.exec(prompt);
if (prompt.trim() === 'fail') {
  out({ type: 'turn.failed', error: { message: 'You are not signed in to ChatGPT. Run codex and sign in.' } });
  process.exit(1);
}
if (titleFor) {
  const first = titleFor[1].trim().split(/\s+/).slice(0, 3).join(' ');
  say(first[0].toUpperCase() + first.slice(1));
} else if (/what did I ask/i.test(words)) {
  say(`You asked: ${asked.at(-1)?.trim().split('\n').at(-1) ?? 'nothing yet'}`);
} else if (/folder/i.test(words)) {
  say(`This folder has: ${fs.readdirSync(process.cwd()).filter((f) => !f.startsWith('.')).join(', ') || 'nothing'}.`);
} else if (about) {
  const found = await tool('search_notes', { query: about[1] });
  if (!Array.isArray(found) || !found.length) say(`I found nothing about ${about[1]}.`);
  else {
    const page = await tool('read_note', { id: found[0].id });
    say('Let me look.');
    say(`You wrote in [${page.title}](${page.path}): “${page.text}”`);
  }
} else if (journal) {
  await tool('append_to_journal', { text: journal[1] });
  say('Added to today’s journal.');
} else {
  say(`You said: ${words}`);
}
out({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
