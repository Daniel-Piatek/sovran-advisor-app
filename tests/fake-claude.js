// A stand-in for the claude command, for tests: no test depends on a real AI model.
// It speaks the same stream-json as `claude -p --output-format stream-json --verbose
// --include-partial-messages`, keeps each Claude conversation in a file in its folder
// (so --resume remembers), and answers by rule:
//   "…folder…"             what is in the folder
//   "make a file NAME"     writes NAME (a Write step), then says so
//   "slow…"                fifty words, slowly (to test Stop)
//   "what did I ask"       the message before
//   "fail"                 exits as if not logged in
// and with the app's tools (--mcp-config), as Claude would use them:
//   "what did I write about X"   search_notes, read_note, then quotes it with a link
//   "add a task: X [on DAY]"     add_task
//   "journal: X"                 append_to_journal
//   "who should I reconnect with"  reconnect_list
//   "log a call with NAME: X"    log_interaction (call, meeting, coffee or message)
//   "tidy the note X"            search_notes, then propose_note_edit (tidied text)
//   "tick the task X"            list_tasks, then propose_task_change (done)
//   "what did I decide here"     read_note on the page it was asked on
//   "plan my week with me"        read_week, then propose_plan: the fullest day's task to a lighter day
//   "shut down the day"           read_day, then propose_close_day with a line
//   "read the file PATH" / "run COMMAND"   asks approve_step first, as Claude Code does
//                                (a command is never really run)
// and as the short-title writer: "Write a short title for this task" → its first three words;
// and as the phone-note tidier (tidy.js): "This was dictated on a phone" → a capital, a full stop after "so" and at the
// end ("rewrite" in the words: it answers with other words, which the app must refuse);
// and as the Inbox reader (assistant/3): it looks up what the capture names, then answers
// with JSON: a task for "book/call/send/buy/fix/pay/ask …" (tomorrow if it says so), the
// journal for "slept/felt/today …", let it go for "spam …", else a note; a home whose
// name the capture uses; "fail-suggest" fails, "slow-suggest" takes two seconds.
//   anything else          "You said: …"
// `claude auth status` (the Check button, ai.js): signed in on Pro, unless a test wrote another state to
// <DATA_DIR>/fake-claude-auth.json; with { fails: "…" } in it, every question fails with those words.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const authFile = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'fake-claude-auth.json') : null;
const auth = authFile && fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, 'utf8'))
  : { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro' };
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(`${JSON.stringify(auth, null, 2)}\n`);
  process.exit(auth.loggedIn ? 0 : 1);
}
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
if (auth.fails && args.includes('-p')) {
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: auth.fails })}\n`);
  process.exit(1);
}
const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const session = after('--resume') ?? after('--session-id');
const memory = path.join(process.cwd(), `.fake-claude-${session}.json`);
fs.writeFileSync(path.join(process.cwd(), '.fake-claude-last-run.json'),
  JSON.stringify({ args, api_key: 'ANTHROPIC_API_KEY' in process.env }));

const out = (event) => process.stdout.write(`${JSON.stringify({ session_id: session, ...event })}\n`);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

const titleFor = /Write a short title for this task[\s\S]*?"""\n([\s\S]*?)\n"""/.exec(prompt);
if (titleFor) {
  // The stand-in's short title: the first three words, with a capital.
  const words = titleFor[1].trim().split(/\s+/).slice(0, 3).join(' ');
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none' });
  out({ type: 'result', subtype: 'success', is_error: false, result: words[0].toUpperCase() + words.slice(1) });
  process.exit(0);
}
const tidyFor = /This was dictated on a phone[\s\S]*?"""\n([\s\S]*?)\n"""/.exec(prompt);
if (tidyFor) {
  const words = tidyFor[1].trim();
  const tidied = /rewrite/i.test(words) ? 'Here is a nicer version of your thought, with different words.'
    : `${words[0].toUpperCase()}${words.slice(1)}`.replace(/ so /, ' so. ').replace(/[.!?]?$/, '.');
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none' });
  out({ type: 'result', subtype: 'success', is_error: false, result: tidied });
  process.exit(0);
}
if (after('--resume') && !fs.existsSync(memory)) {
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: `No conversation found with session ID: ${session}` });
  process.exit(1);
}
if (prompt.trim() === 'fail') {
  process.stderr.write('Not logged in. Run claude and sign in.\n');
  process.exit(1);
}
const asked = fs.existsSync(memory) ? JSON.parse(fs.readFileSync(memory, 'utf8')) : [];
fs.writeFileSync(memory, JSON.stringify([...asked, prompt]));
out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', model: { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' }[after('--model')] ?? 'claude-opus-5-5' }); // as the real one names the model --model chose

async function say(text, every = 5) {
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } });
  for (const word of text.split(/(?<= )/)) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } } });
    await pause(every);
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
}

// The app's tools, over MCP, as the config file says.
const configFile = after('--mcp-config');
const config = configFile ? JSON.parse(fs.readFileSync(configFile, 'utf8')).mcpServers.app : null;
let calls = 0;
async function tool(name, input) {
  if (!config) throw new Error('No tools.');
  const rpc = (method, params) => fetch(config.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...config.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++calls, method, params }),
  }).then((r) => r.json());
  if (calls === 0) await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '1' } });
  const id = `toolu_${calls}`;
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__app__${name}`, input }] } });
  const { result } = await rpc('tools/call', { name, arguments: input });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: result.content, is_error: result.isError }] } });
  return result.isError ? null : (() => { try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; } })();
}
const tidy = (text) => text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  .map((line) => line[0].toUpperCase() + line.slice(1)).join('\n\n');

// Claude Code's own permission prompt (assistant/4): before a step, it asks the app's
// approve_step tool, as --permission-prompt-tool tells the real claude command to.
async function mayI(toolName, input) {
  const tool = after('--permission-prompt-tool');
  if (!tool) return true;
  const rpc = (method, params) => fetch(config.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...config.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++calls, method, params }),
  }).then((r) => r.json());
  if (calls === 0) await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '1' } });
  const { result } = await rpc('tools/call', { name: tool.replace('mcp__app__', ''), arguments: { tool_name: toolName, input } });
  return JSON.parse(result.content[0].text).behavior === 'allow';
}
const readFile = /read the file (.+?)\s*$/im.exec(prompt);
const runIt = /^run (.+)$/im.exec(prompt);
const made = /make a file (\S+)/i.exec(prompt);
const about = /what did I write about (?:the )?(.+?)\??$/im.exec(prompt);
const task = /add a task:\s*(.+?)(?: on (\d{4}-\d{2}-\d{2}))?\.?$/im.exec(prompt);
const journal = /^journal:\s*(.+)$/im.exec(prompt);
const reconnect = /who should I reconnect with/i.test(prompt);
const logged = /log an? (call|meeting|coffee|message) with ([^:]+):\s*(.+?)\.?$/im.exec(prompt);
const tidyNote = /tidy the note (.+?)\.?$/im.exec(prompt);
const answerComment = /answer this comment i left[\s\S]*?The passage i mean: “(.+?)”\nMy comment \(id ([0-9a-f-]{36})\): (.+)$/im.exec(prompt);
const readBoard = /what is (?:missing|on) (?:in|on) the (.+?) board/i.exec(prompt);
const drawBreak = /add a break after the (.+?)\.?$/im.exec(prompt);
const findHour = /find an hour for (?:the )?(.+?) this week/i.exec(prompt);
const handwriting = /read the handwriting in the picture file (\S+)/i.exec(prompt);
const goOn = /go on with the note/i.test(prompt);
const clashNotes = [...prompt.matchAll(/\(Note from the app: ([^\n]*)\)$/gm)].map((m) => m[1]);
const goThrough = /go through my comments/i.test(prompt);
const draft = /draft a reply to the mail about (.+?):\s*(.+?)(?: to (\S+@\S+))?\.?$/im.exec(prompt);
const mailTask = /make a task of the mail about (.+?)\.?$/im.exec(prompt);
const tick = /tick the task (.+?)\.?$/im.exec(prompt);
const here = /what did I decide here/i.test(prompt) && /\/(?:notes|journal\/entries)\/([0-9a-f-]{36})/.exec(prompt);
const capture = /You sort one capture from the owner’s Inbox[\s\S]*?"""\n([\s\S]*?)\n"""/.exec(prompt);
let answer;
if (/plan my week with me/i.test(prompt)) {
  const week = await tool('read_week', {});
  const over = [...week.days].sort((a, b) => b.over_by_minutes - a.over_by_minutes)[0];
  if (over && over.over_by_minutes > 0) {
    const lightest = week.days.filter((d) => d.day > over.day).sort((a, b) => a.planned_minutes - b.planned_minutes)[0]
      ?? week.days.filter((d) => d.day !== over.day).sort((a, b) => a.planned_minutes - b.planned_minutes)[0];
    const task = over.tasks.filter((t) => !t.done && !t.weekly_goal).at(-1) ?? over.tasks.filter((t) => !t.done).at(-1);
    await tool('propose_plan', { move: 'move', task_id: task.id, day: lightest.day, reason: `${over.day} is over budget by ${over.over_by_minutes} min; ${lightest.day} has room` });
    answer = `${over.day} holds too much, over by ${over.over_by_minutes} minutes. I proposed moving “${task.text}”: it waits on the card.`;
  } else answer = 'The week fits as it is.';
} else if (/shut down the day/i.test(prompt)) {
  const day = await tool('read_day', {});
  const done = day.tasks.filter((t) => t.done).length;
  const highlight = day.highlight ? (day.tasks.find((t) => t.text === day.highlight)?.done ? 'done' : 'not_done') : '';
  await tool('propose_close_day', { line: `Did ${done} of ${day.tasks.length}${day.highlight ? `, Highlight ${highlight === 'done' ? 'done' : 'not done'}` : ''}.`, highlight });
  answer = 'I suggested a line for the day: it is saved only when you approve the card.';
} else if (readFile) {
  if (await mayI('Read', { file_path: readFile[1] })) {
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: readFile[1] } }] } });
    const first = fs.readFileSync(readFile[1], 'utf8').split('\n')[0];
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_read', content: first }] } });
    answer = `It begins: ${first}`;
  } else answer = 'I wasn’t allowed to read it.';
} else if (runIt) {
  // A stand-in never really runs a command.
  answer = (await mayI('Bash', { command: runIt[1].trim() })) ? `Ran: ${runIt[1].trim()}` : 'I wasn’t allowed to run it.';
} else if (capture) {
  const words = capture[1].trim();
  if (/fail-suggest/.test(words)) { process.stderr.write('Overloaded.\n'); process.exit(1); }
  if (/slow-suggest/.test(words)) await pause(2000);
  const connects = [];
  for (const word of words.split(/\W+/).filter((w) => w.length > 3).slice(0, 4)) {
    const found = await tool('search_notes', { query: word });
    if (Array.isArray(found)) for (const f of found) if (!connects.includes(f.id)) connects.push(f.id);
  }
  const homes = [...prompt.matchAll(/^- ([0-9a-f-]{36}) \(([^)]+)\) (.+)$/gm)];
  const home = homes.find((h) => words.toLowerCase().includes(h[3].toLowerCase()));
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const kind = /^(book|call|send|buy|fix|pay|ask|email|write)\b/i.test(words) ? 'task'
    : /^(slept|felt|today)\b/i.test(words) ? 'journal' : /^spam\b/i.test(words) ? 'let_go' : 'note';
  const why = { task: 'It starts with something to do.', journal: 'It says how the day went.', let_go: 'It needs nothing from you.', note: 'It is something to keep.' }[kind];
  answer = JSON.stringify({
    title: words[0].toUpperCase() + words.slice(1, 60), summary: words.slice(0, 120), kind,
    day: kind === 'task' && /tomorrow/i.test(words) ? day : '', home_id: home?.[1] ?? '', connects, why,
  });
} else if (about) {
  const found = await tool('search_notes', { query: about[1] });
  if (!Array.isArray(found)) answer = `I found nothing about ${about[1]}.`;
  else {
    const page = await tool('read_note', { id: found[0].id });
    answer = `You wrote in [${page.title}](${page.path}): “${page.text}”`;
  }
} else if (answerComment) {
  await tool('reply_to_comment', { comment_id: answerComment[2], text: `About “${answerComment[1]}”: ${answerComment[3].replace(/\?$/, '')}? Not too low if the prep is included.` });
  answer = 'I answered in the comment’s thread.';
} else if (findHour) {
  // Reads the calendar for the week, takes the first afternoon gap of an hour or more, and proposes it as a card.
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 6);
  const week = await tool('calendar_list', { from: dayOf(from), to: dayOf(to) }).catch(() => null); // not offered: the module is off
  let chosen = null;
  for (const d of Array.isArray(week) ? week : []) {
    const weekday = new Date(`${d.day}T12:00:00`).getDay();
    if (weekday === 0 || weekday === 6) continue;
    const gap = d.free.find((g) => g.free_minutes >= 60 && g.to > '14:00' && (g.from >= '13:00' || g.to >= '15:00'));
    if (gap) { chosen = { day: d.day, from: gap.from >= '14:00' ? gap.from : '14:00', after: gap.after, weekday: new Date(`${d.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }) }; break; }
  }
  if (!Array.isArray(week)) answer = 'I have no way to look at your calendar.';
  else if (!chosen) answer = 'I could not find a free hour this week.';
  else {
    const end = `${pad(Number(chosen.from.slice(0, 2)) + 1)}:${chosen.from.slice(3)}`;
    const made = await tool('calendar_propose', {
      title: findHour[1].replace(/^\w/, (c) => c.toUpperCase()), starts_at: `${chosen.day}T${chosen.from}`, ends_at: `${chosen.day}T${end}`,
      reason: `${chosen.weekday} at ${chosen.from}: free in your calendar and your plan${chosen.after ? `, after ${chosen.after}` : ''}`,
    });
    answer = made?.waiting ? `${chosen.weekday} at ${chosen.from} is free in your calendar and your plan. It waits for your approval on the card.` : 'Proposed it.';
  }
} else if (drawBreak) {
  const boards = await tool('board_read', {});
  const read = Array.isArray(boards) ? await tool('board_read', { board_id: boards[0].board_id }) : null;
  const wanted = drawBreak[1].toLowerCase();
  const cardId = read && new RegExp(`Card \\[([0-9a-f-]{36})\\]: ${drawBreak[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').exec(read)?.[1];
  const next = read && [...read.matchAll(/Card \[([0-9a-f-]{36})\]: (.+?)(?: —|$)/gm)].find((m) => m[1] !== cardId && !m[2].toLowerCase().includes(wanted) && /q&a|questions/i.test(m[2]));
  if (!cardId) answer = `I could not find ${drawBreak[1]} on the board.`;
  else {
    const made = await tool('board_draw', { board_id: boards[0].board_id, reason: 'A pause after the pricing case', items: [
      { kind: 'card', key: 'break', text: 'Break', x: 700, y: 330 },
      { kind: 'arrow', from: cardId, to: 'break' },
      ...(next ? [{ kind: 'arrow', from: 'break', to: next[1] }] : []),
    ] });
    answer = made?.waiting ? 'It waits for your approval on the card.' : 'Drew a break.';
  }
} else if (readBoard) {
  const boards = await tool('board_read', {});
  const text = Array.isArray(boards) ? await tool('board_read', { board_id: boards[0].board_id }) : 'There are no boards yet.';
  answer = `On the ${readBoard[1]} board: ${String(text).replace(/\n/g, ' ')}`;
} else if (handwriting) {
  // A stand-in reads no handwriting: it checks that a picture is there, and answers what the tests' ink says.
  const file = path.join(process.cwd(), handwriting[1]);
  const png = fs.existsSync(file) && fs.readFileSync(file).subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  answer = png ? (/unreadable/i.test(prompt) ? '' : 'longer?') : 'I could not open the picture.';
} else if (goOn) {
  answer = clashNotes.length ? `Understood. ${clashNotes.join(' ')}` : 'Going on with the note.';
} else if (goThrough) {
  const later = await tool('list_comments', {});
  if (!Array.isArray(later)) answer = 'No comments are waiting.';
  else {
    for (const c of later) await tool('reply_to_comment', { comment_id: c.comment_id, text: `Looking at “${c.passage}”: noted, here is my answer to “${c.comment}”.` });
    answer = `I went through ${later.length} comment${later.length === 1 ? '' : 's'}.`;
  }
} else if (draft) {
  const found = await tool('mail_search', { query: draft[1] });
  if (!Array.isArray(found)) answer = `I found no mail about ${draft[1]}.`;
  else {
    const made = await tool('mail_draft', { thread_id: found[0].thread_id, text: draft[2], ...(draft[3] ? { to: draft[3] } : {}) });
    answer = made?.waiting ? 'The draft waits on the card: Send, Edit or Dismiss.' : 'The app refused the draft.';
  }
} else if (mailTask) {
  const found = await tool('mail_search', { query: mailTask[1] });
  const made = Array.isArray(found) ? await tool('mail_to_task', { thread_id: found[0].thread_id }) : null;
  answer = made?.waiting ? 'It waits for your approval on the card.' : made?.added ? `Added “${made.added.text}”.` : 'I found no such mail.';
} else if (task) {
  const added = await tool('add_task', { text: task[1], ...(task[2] ? { due: task[2] } : {}) });
  answer = added.waiting ? 'It waits for your approval on the card.' : `Added “${added.added.text}”. You can undo it on the card.`;
} else if (reconnect) {
  const list = await tool('reconnect_list', {});
  answer = Array.isArray(list) ? `Most overdue first: ${list.map((p) => `${p.name} (${p.status})`).join(', ')}.` : 'Nobody has a rhythm yet.';
} else if (logged) {
  const made = await tool('log_interaction', { person: logged[2].trim(), kind: logged[1], sentence: logged[3] });
  answer = made.waiting ? 'It waits for your approval on the card.' : `Logged it with ${made.logged.with}. You can undo it on the card.`;
} else if (journal) {
  await tool('append_to_journal', { text: journal[1] });
  answer = 'Written in your journal.';
} else if (tidyNote) {
  const found = await tool('search_notes', { query: tidyNote[1] });
  const page = await tool('read_note', { id: found[0].id });
  await tool('propose_note_edit', { id: page.id, body: tidy(page.text), reason: 'Tidied the spacing and capitals' });
  answer = 'I proposed a tidier version: it waits on the card for you.';
} else if (tick) {
  const open = await tool('list_tasks', { when: 'all' });
  const found = open.find((t) => t.text.toLowerCase().includes(tick[1].toLowerCase()));
  await tool('propose_task_change', { id: found.id, done: true, reason: 'You said it is done' });
  answer = 'Ticking it waits on the card for you.';
} else if (here) {
  const page = await tool('read_note', { id: here[1] });
  answer = `Here you decided: “${page.text.split('\n')[0]}” ([${page.title}](${page.path}))`;
} else if (made) {
  const file = path.join(process.cwd(), made[1]);
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: file, content: 'hi' } }] } });
  fs.writeFileSync(file, 'hi\n');
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `File created successfully at: ${file}` }] } });
  answer = `Made ${made[1]}.`;
} else if (/folder/i.test(prompt)) {
  const files = fs.readdirSync(process.cwd()).filter((f) => !f.startsWith('.'));
  answer = files.length ? `This folder has: ${files.join(', ')}.` : 'This folder is empty so far.';
} else if (/^slow/i.test(prompt.trim())) {
  await say(Array.from({ length: 50 }, (_, i) => `word${i + 1}`).join(' '), 150);
  answer = null;
} else if (/what did I ask/i.test(prompt)) {
  answer = asked.length ? `You asked: ${asked.at(-1).trim()}` : 'Nothing yet.';
} else {
  answer = `You said: ${prompt.trim()}`;
}
if (answer) await say(answer);
out({ type: 'result', subtype: 'success', is_error: false, result: answer ?? 'slow' });
