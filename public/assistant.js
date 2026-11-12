// The assistant (assistant/1): a chat where Claude Code answers, on the owner's own Claude
// plan, in its own folder for each conversation.
//   /assistant        a new chat, with example questions as chips; earlier chats beside it
//   /assistant/:id    one conversation: its history, and the next message carries it on
// The answer streams in word by word; Stop ends it (what came is kept). Under an answer,
// its steps (the tools it used, the files it made) are folded. Enter sends, Shift+Enter
// starts a new line.
// It reaches your notes, journal and tasks through the app's own tools (assistant/2):
// under an answer, the pages it used are Citations (each opens its page), and what it did
// or proposes is a card: a task you asked for is added at once (Undo); a change you did
// not ask for in so many words waits for Apply or Dismiss (then Undo). The Ask your notes
// box at the bottom of every page (public/shell.js) asks from that page.

import markdownit from '/vendor/markdown-it/index.mjs';
import { el, icon, request, undoBar, clockTime } from './ui.js';
import { AI_NAMES, aiLabel } from './ai-names.js';
import { app, screen, onLeave, takeQuestion } from './shell.js';
import { dueLabel } from './due.js';
import { firstWordWords } from './spoken.js';
import { callControls } from './call.js';

const markdown = markdownit({ html: false, linkify: true, breaks: true });
// A link to a page of the app opens it in the app; any other link opens beside the app.
const renderLink = markdown.renderer.rules.link_open ?? ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
markdown.renderer.rules.link_open = (tokens, i, options, env, self) => {
  if (!tokens[i].attrGet('href')?.startsWith('/')) {
    tokens[i].attrSet('target', '_blank');
    tokens[i].attrSet('rel', 'noopener noreferrer');
  }
  return renderLink(tokens, i, options, env, self);
};

export const assistantApi = {
  list: () => request('GET', '/api/conversations'),
  create: () => request('POST', '/api/conversations', {}),
  get: (id) => request('GET', `/api/conversations/${id}`),
  rename: (id, title) => request('PATCH', `/api/conversations/${id}`, { title }),
  remove: (id) => request('DELETE', `/api/conversations/${id}`),
  restore: (id) => request('POST', `/api/conversations/${id}/restore`, {}),
  stop: (id) => request('POST', `/api/conversations/${id}/stop`, {}),
  card: (id, what) => request('POST', `/api/assistant-actions/${id}/${what}`, {}),
};

const KIND_ICONS = { note: 'notes', 'journal entry': 'journal', person: 'person', company: 'person', 'key element': 'key_element', goal: 'goal', project: 'project', topic: 'topic', habit: 'habit' };

// The pages an answer used: each a Citation that opens its page.
function citations(sources) {
  if (!sources?.length) return null;
  return el('div', { class: 'citations', 'aria-label': 'Sources' },
    ...sources.map((s) => el('a', { class: 'citation', href: s.path }, icon(KIND_ICONS[s.kind] ?? 'notes'),
      el('span', { class: 'citation-title' }, s.title), el('span', { class: 'citation-kind' }, s.kind))));
}

// What a card is, in words ("Add a task: “Call the venue” · Tomorrow"): on the card, and said on a call (public/call.js).
export function cardWhat(card) {
  const asks = card.state === 'proposed';
  return {
    add_task: () => `${asks ? 'Add' : 'Added'} a task: “${card.title}”${/^\d{4}-/.test(card.after.due ?? '') ? ` · ${dueLabel(card.after.due)}` : ''}`,
    calendar_propose: () => `${card.after.move ? `${asks ? 'Move' : 'Moved'} “${card.after.was.title}” to` : `${asks ? 'Add' : 'Added'} “${card.after.title}”`} ${card.after.starts_at.slice(0, 10)} ${card.after.starts_at.slice(11)}–${card.after.ends_at.slice(11)}${card.after.where === 'google' ? ' in Google Calendar' : ''}${card.after.people?.length ? ` with ${card.after.people.map((p) => p.name).join(', ')}` : ''}${card.reason ? ` · ${card.reason}` : ''}`,
    board_draw: () => `${asks ? 'Draw' : 'Drew'} on the board “${card.after.board_title}”: ${[card.after.items.filter((i) => i.kind !== 'arrow').length ? `${card.after.items.filter((i) => i.kind !== 'arrow').length} new` : '', card.after.items.filter((i) => i.kind === 'arrow').length ? `${card.after.items.filter((i) => i.kind === 'arrow').length} arrow(s)` : ''].filter(Boolean).join(' and ')}${card.reason ? ` · ${card.reason}` : ''}`,
    mail_send: () => `${asks ? 'Send' : card.state === 'dismissed' ? 'Did not send' : 'Sent'} a mail to ${(card.after.to ?? []).join(', ')}: “${card.after.subject}”`,
    add_note: () => `${asks ? 'Add' : 'Added'} a note: “${card.title}”`,
    log_interaction: () => `${asks ? 'Log' : 'Logged'} ${card.after.kind === 'other' ? 'something' : `a ${card.after.kind}`} with ${card.after.name}: “${card.after.note}”${/^\d{4}-/.test(card.after.when ?? '') && card.after.when ? ` · ${dueLabel(card.after.when.slice(0, 10))}` : ''}`,
    append_to_journal: () => `${asks ? 'Write' : 'Wrote'} in your journal: “${card.title}”`,
    step: () => `${card.state === 'refused' ? 'Wanted to' : 'Wants to'}: ${card.title}${card.reason ? ` · ${card.reason}` : ''}`,
    plan: () => `${card.title}${card.reason ? ` · ${card.reason}` : ''}`,
    close_day: () => `Close ${dueLabel(card.after.day)} with the line “${card.after.line}”${card.after.highlight ? ` · Highlight ${({ done: 'done', not_done: 'not done', moved: 'moved' })[card.after.highlight]}` : ''}`,
    edit_note: () => `A change to “${card.title}”${card.reason ? `: ${card.reason}` : ''}`,
    change_task: () => (card.after.done === true ? `Tick “${card.title}”` : card.after.done === false ? `Untick “${card.title}”`
      : `Move “${card.title}” to ${card.after.due ? dueLabel(card.after.due) : 'no day'}`) + (card.reason ? ` · ${card.reason}` : ''),
  }[card.kind]();
}

// What it did, or proposes: a card with what it is, and Apply / Dismiss / Undo.
export function cardNode(card, changed) {
  const act = (what) => async () => {
    try { changed(await assistantApi.card(card.id, what)); } catch (err) { note.textContent = err.message; }
  };
  const note = el('p', { class: 'capture-problem', role: 'alert' });
  const what = cardWhat(card);
  const step = card.kind === 'step';
  const adds = ['add_task', 'add_note', 'append_to_journal', 'close_day', 'log_interaction', 'board_draw', 'calendar_propose'].includes(card.kind);
  const states = {
    done: '', proposed: 'Waiting for you', applied: card.kind === 'mail_send' ? 'Sent, with ten seconds to undo' : step ? 'Allowed' : adds ? 'Approved' : 'Applied',
    dismissed: step ? 'Not allowed' : adds ? 'Not now' : 'Dismissed', undone: 'Taken back', refused: 'Never allowed',
  };
  // An approval card: Approve / Not now for what it would add, Allow once / No for a step
  // of its own, Apply / Dismiss for a change.
  const [yes, no] = card.kind === 'mail_send' ? ['Send', 'Dismiss'] : step ? ['Allow once', 'No'] : adds ? ['Approve', 'Not now'] : ['Apply', 'Dismiss'];
  const buttons = card.state === 'proposed'
    ? [el('button', { type: 'button', class: 'button', onclick: act('apply') }, yes),
      ...(card.kind === 'mail_send' ? [el('a', { class: 'button', href: `/mail?${new URLSearchParams({ thread: card.after.thread_id, draft: card.id })}` }, 'Edit')] : []),
      ...(step && card.after?.rule ? [el('button', { type: 'button', class: 'button', title: card.after.label, onclick: act('always') }, 'Always allow')] : []),
      el('button', { type: 'button', class: 'button button-quiet', onclick: act('dismiss') }, no)]
    : ['done', 'applied'].includes(card.state) && !step ? [el('button', { type: 'button', class: 'button button-quiet', onclick: act('undo') }, 'Undo')] : [];
  const preview = card.kind === 'edit_note' && card.state === 'proposed'
    ? [el('div', { class: 'action-preview' },
      ...(card.after.title !== card.before.title ? [el('p', { class: 'action-preview-title' }, card.after.title)] : []),
      el('p', { class: 'action-preview-text' }, card.after.body.length > 600 ? `${card.after.body.slice(0, 600)}…` : card.after.body))]
    : [];
  if (card.kind === 'board_draw' && card.state !== 'dismissed') {
    preview.push(el('div', { class: 'action-preview' },
      el('ul', { class: 'draw-list', 'aria-label': 'What it would draw' }, ...card.after.items.map((i) => el('li', {}, i.kind === 'arrow' ? `Arrow: ${i.label || 'from one card to another'}` : `${i.kind === 'text' ? 'Text' : 'Card'}: ${i.text}`))),
      ...(card.state !== 'proposed' ? [el('a', { href: `/boards/${card.after.board_id}` }, 'Open the board')] : [])));
  }
  if (card.kind === 'calendar_propose' && card.state !== 'dismissed') {
    const o = card.after.overlaps ?? [];
    preview.push(el('div', { class: 'action-preview' },
      el('p', { class: 'action-preview-text' }, card.after.where === 'google'
        ? `In Google Calendar${card.after.meet ? ', with a Meet link' : ''}. It goes to Google only when you approve; nothing exists until then.`
        : 'In your own calendar. Nothing exists until you approve.'),
      ...(o.length ? [el('p', { class: 'plan-warning', role: 'note' }, `It overlaps ${o.map((x) => `“${x.title}” (${x.starts_at.slice(11)}–${x.ends_at.slice(11)})`).join(', ')}.`)] : [])));
  }
  if (card.kind === 'mail_send' && card.state !== 'dismissed') preview.push(el('div', { class: 'action-preview' }, el('p', { class: 'action-preview-text' }, card.after.body.length > 600 ? `${card.after.body.slice(0, 600)}…` : card.after.body)));
  return el('div', { class: 'action-card', 'data-kind': card.kind, 'data-state': card.state, role: 'group', 'aria-label': what },
    el('p', { class: 'action-what' }, icon({ add_task: 'task', change_task: 'task', edit_note: 'notes', add_note: 'notes', append_to_journal: 'journal', log_interaction: 'log', mail_send: 'mail', calendar_propose: 'calendar', board_draw: 'board', step: 'lock', plan: 'planner', close_day: 'moon' }[card.kind]), el('span', {}, what),
      states[card.state] ? el('em', { class: 'plan-free' }, states[card.state]) : null),
    ...preview,
    ...(buttons.length ? [el('div', { class: 'action-buttons' }, ...buttons)] : []),
    note);
}

const STEP_NAMES = {
  Write: 'Wrote', Edit: 'Changed', MultiEdit: 'Changed', Read: 'Read', Bash: 'Ran', Glob: 'Looked for', Grep: 'Searched for', LS: 'Listed',
  WebFetch: 'Opened', WebSearch: 'Searched the web for', ToolSearch: 'Got its tools ready',
  mcp__app__docs_read: 'Read the help page', mcp__app__search_notes: 'Searched your notes for', mcp__app__read_note: 'Read', mcp__app__list_tasks: 'Looked at your tasks', mcp__app__my_life: 'Looked at My Life', mcp__app__read_life_item: 'Read',
  mcp__app__add_task: 'Added a task', mcp__app__append_to_journal: 'Wrote in your journal', mcp__app__log_interaction: 'Logged an interaction', mcp__app__reconnect_list: 'Looked at who is due to reconnect',
  mcp__app__calendar_list: 'Looked at your calendar', mcp__app__calendar_propose: 'Proposed an event', mcp__app__board_read: 'Read a board', mcp__app__board_draw: 'Drew on a board', mcp__app__list_comments: 'Looked at the comments left for it', mcp__app__reply_to_comment: 'Answered a comment', mcp__app__mail_search: 'Searched your mail for', mcp__app__mail_read: 'Read a conversation', mcp__app__mail_draft: 'Drafted a mail', mcp__app__mail_to_task: 'Made a task of a mail',
  mcp__app__propose_note_edit: 'Proposed a change to a note', mcp__app__propose_task_change: 'Proposed a change to a task',
};

// The steps under an answer, folded: what it did, and the files it made.
function stepsNode(steps) {
  if (!steps.length) return null;
  const files = [...new Set(steps.map((s) => s.file).filter(Boolean))];
  return el('details', { class: 'chat-steps' },
    el('summary', {}, `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}${files.length ? ` · ${files.length === 1 ? '1 file' : `${files.length} files`}` : ''}`),
    el('ol', { class: 'chat-step-list' }, ...steps.map((s) => el('li', { class: 'chat-step', 'data-state': s.state },
      el('span', { class: 'chat-step-tool' }, STEP_NAMES[s.tool] ?? s.tool),
      s.detail ? el('code', { class: 'chat-step-detail' }, s.detail) : null,
      s.state === 'failed' ? el('span', { class: 'plan-free' }, ' · failed') : null))),
    ...(files.length ? [el('p', { class: 'chat-files' }, icon('notes'), files.join(', '))] : []));
}

const aiChip = (ai, words) => el('span', { class: 'chat-ai', 'data-ai': ai }, words);

// What to keep of a reply: the part selected inside it, else all of it. The title is its first line, without the marks.
function keepOf(message, body) {
  const selection = window.getSelection();
  const picked = selection && !selection.isCollapsed && body.contains(selection.anchorNode) && body.contains(selection.focusNode) ? selection.toString().trim() : '';
  const text = picked || message.text.trim();
  const first = text.split('\n').find((line) => line.trim()) ?? '';
  return { text, title: first.replace(/^[#>*\-\s\d.]+/, '').replace(/[*_`]/g, '').trim().slice(0, 80), part: Boolean(picked) };
}

// Under a finished reply: send it to the Inbox to be sorted later. A selected part is kept alone.
function keepButtons(message, body) {
  const result = el('span', { class: 'chat-keep-result', role: 'status' });
  const done = (text, href) => result.replaceChildren(text, ...(href ? [' ', el('a', { href }, 'Open')] : []));
  const inbox = el('button', { type: 'button', class: 'button button-quiet', title: 'Send this reply (or the part you selected) to the Inbox', onclick: async () => {
    const { text } = keepOf(message, body);
    try { await request('POST', '/api/captures', { body: text, world: 'inner' }); done('Sent to the Inbox.', '/inbox'); } catch (err) { done(`Couldn't send: ${err.message}`); }
  } }, 'Send to Inbox');
  return el('div', { class: 'chat-keep' }, inbox, result);
}

// How a turn of a call went (advanced/voice/3-6), under your words and under its answer: said on a call, where the answer
// came from, the line it said while it thought, and the time to its first word (Metric chips).
function callMarkNodes(mark) {
  if (!mark) return [];
  if (mark.said) return [el('p', { class: 'chat-call-mark' }, icon('phone'), 'Said on a call')];
  return [el('p', { class: 'chat-call-mark' }, icon('phone'), 'Voice call',
    el('span', { class: 'metric-chip' }, mark.source === 'data' ? 'from your data, no model' : 'your assistant'),
    ...(mark.first_word_ms != null ? [el('span', { class: 'metric-chip' }, firstWordWords(mark.first_word_ms))] : []),
    ...(mark.first_word_ms != null && !mark.warm ? [el('span', { class: 'metric-chip' }, 'cold start')] : [])),
  ...(mark.filler ? [el('p', { class: 'chat-call-mark' }, `Said while it thought: “${mark.filler}”`)] : [])];
}

// A bubble: yours on the right, the assistant's on the left with its label.
function bubble(message, changed = () => {}, mark = null) {
  if (message.role === 'user') {
    return el('div', { class: 'chat-bubble is-user', 'data-role': 'user' }, el('p', { class: 'chat-text' }, message.text),
      ...(message.context ? [el('a', { class: 'chat-context', href: message.context.path }, 'Asked on: ', message.context.title || message.context.path)] : []),
      ...callMarkNodes(mark));
  }
  const body = el('div', { class: 'chat-text' });
  body.innerHTML = markdown.render(message.text);
  // Short table cells keep their words on one line ("4. Reconnect", 2026-11-11, the owner's wish).
  for (const cell of body.querySelectorAll('td')) if (cell.textContent.trim().length <= 24) cell.classList.add('is-short');
  const node = el('div', { class: 'chat-bubble is-assistant', 'data-role': 'assistant', 'data-state': message.state },
    el('span', { class: 'chat-who' }, icon('assistant'), 'Assistant',
      ...(aiLabel(message) && !(mark && mark.source === 'data') ? [el('span', { class: 'plan-free' }, ' · '), aiChip(message.ai, aiLabel(message))] : []),
      el('span', { class: 'plan-free' }, ` · ${clockTime(message.created_at)}`)),
    body,
    ...(message.state === 'answering' ? [el('span', { class: 'chat-working', 'aria-label': 'Answering' }, '…')] : []),
    ...(message.state === 'stopped' ? [el('p', { class: 'chat-note' }, 'Stopped.')] : []),
    ...(message.state === 'answering' || !message.text?.trim() ? [] : [keepButtons(message, body)]),
    ...callMarkNodes(mark),
    citations(message.sources),
    ...(message.cards ?? []).map((card) => cardNode(card, (next) => { Object.assign(card, next); changed(); })),
    stepsNode(message.steps));
  return node;
}

export async function showAssistant(id) {
  document.title = 'Assistant';
  app.className = 'page page-wide assistant-page';
  let conversation = null;
  let answering = false;
  let left = false;
  let chosen = ''; // the AI chosen in Settings now (claude or codex)
  onLeave(() => { left = true; });

  const list = el('nav', { class: 'chat-list', 'aria-label': 'Your chats' });
  const thread = el('div', { class: 'chat-thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const input = el('textarea', { class: 'chat-input', 'aria-label': 'Message', rows: 2, placeholder: 'Ask your assistant', maxlength: 20000 });
  const sendButton = el('button', { type: 'button', class: 'button chat-send', onclick: () => send(input.value) }, 'Send');
  const stopButton = el('button', { type: 'button', class: 'button chat-stop', hidden: true, onclick: () => stop() }, 'Stop');
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  // Model and effort (module ai-pick, ai-pick.js): two choices above the box to ask in, kept for each chat.
  // Shown while the module is on; the choices are those of the AI that answers now (Claude or ChatGPT).
  const modelBox = el('select', { class: 'chat-pick-select', 'aria-label': 'Model' });
  const effortBox = el('select', { class: 'chat-pick-select', 'aria-label': 'Effort' });
  const pickRow = el('div', { class: 'chat-pick', hidden: true },
    el('label', { class: 'chat-pick-field' }, el('span', { class: 'chat-pick-label' }, 'Model'), modelBox),
    el('label', { class: 'chat-pick-field' }, el('span', { class: 'chat-pick-label' }, 'Effort'), effortBox));
  let pickOn = false;
  const fillPick = (box, options, value) => box.replaceChildren(...options.map((o) => el('option', {
    value: o.id, ...(o.id === value ? { selected: true } : {}) }, `${o.label} · ${o.hint}`)));
  async function drawPick() {
    try {
      const state = await request('GET', `/api/assistant/pick${conversation ? `?chat=${conversation.id}` : ''}`);
      pickOn = state.on;
      fillPick(modelBox, state.models, state.model);
      fillPick(effortBox, state.efforts, state.effort);
    } catch { pickOn = false; }
    pickRow.hidden = !pickOn;
  }
  const savePick = async () => {
    problem.textContent = '';
    try {
      await request('PUT', '/api/assistant/pick', { ...(conversation ? { chat: conversation.id } : {}), model: modelBox.value, effort: effortBox.value });
    } catch (err) { problem.textContent = err.message; }
  };
  modelBox.addEventListener('change', savePick);
  effortBox.addEventListener('change', savePick);
  const undoPlace = el('div', {});
  // Wide view (2026-11-11, the owner's wish): the conversation in a large window over the page, its size
  // dragged at the corner, closed with the button, Esc or a click beside it. Remembered on this computer.
  const wideButton = el('button', { type: 'button', class: 'button button-quiet chat-wide-toggle', 'aria-pressed': 'false', onclick: () => setWide(!wide) });
  const backdrop = el('div', { class: 'chat-backdrop', hidden: true, onclick: () => setWide(false) });
  let wide = false;
  const title = el('h1', { class: 'top-bar-title' }, 'Assistant');
  const actions = el('span', { class: 'chat-actions' });
  // New chat is the page's one red button, beside the title as on every section's page (2026-11-10, the owner's wish).
  const newChat = el('a', { class: 'button button-primary page-add', href: '/assistant' }, icon('plus'), 'New chat');
  // A voice call with your assistant (advanced/voice/3-7, public/call.js): a thin front over this chat.
  const call = callControls({
    conversationId: () => conversation?.id ?? null,
    ensureConversation: async () => {
      if (!conversation) {
        conversation = { ...(await assistantApi.create()), messages: [] };
        history.replaceState(null, '', `/assistant/${conversation.id}`);
      }
      return conversation.id;
    },
    reload: async (conversationId) => {
      if (left) return;
      if (conversationId && conversationId !== conversation?.id) history.replaceState(null, '', `/assistant/${conversationId}`);
      await load(conversationId ?? conversation?.id ?? null);
    },
    ask: (text, onEvent) => send(text, null, { onEvent }),
    act: async (card, what) => { const next = await assistantApi.card(card.id, what); Object.assign(card, next); if (!left && conversation) await load(conversation.id); return card; },
    busy: () => answering,
    writeIn: (words) => { input.value = words; input.focus(); },
  });
  onLeave(() => call.end());

  screen.replaceChildren(
    el('header', { class: 'top-bar' }, title, newChat),
    // Your chats on the left, the chat on the right, each a panel of its own on the grey, like the Planner.
    el('div', { class: 'chat-layout' },
      list,
      backdrop,
      el('section', { class: 'chat-pane', 'aria-label': 'Chat' }, el('div', { class: 'chat-pane-bar' }, wideButton), thread,
        call.widget,
        pickRow,
        el('div', { class: 'chat-composer' }, input, el('span', { class: 'chat-buttons' }, call.button, stopButton, sendButton)), problem)),
    undoPlace,
  );

  function setWide(on) {
    wide = on;
    const pane = screen.querySelector('.chat-pane');
    pane.classList.toggle('is-wide', on);
    if (!on) { pane.style.width = ''; pane.style.height = ''; }
    backdrop.hidden = !on;
    wideButton.setAttribute('aria-pressed', String(on));
    wideButton.replaceChildren(icon(on ? 'close' : 'open'), on ? 'Close wide view' : 'Wide view');
    try { localStorage.setItem('assistant.wide', on ? '1' : ''); } catch { /* not kept: fine */ }
    thread.scrollTop = thread.scrollHeight;
  }
  const escape = (e) => { if (e.key === 'Escape' && wide) setWide(false); };
  document.addEventListener('keydown', escape);
  onLeave(() => document.removeEventListener('keydown', escape));
  let wasWide = false;
  try { wasWide = localStorage.getItem('assistant.wide') === '1'; } catch { /* none */ }
  setWide(wasWide && window.matchMedia('(min-width: 900px)').matches);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });

  function setAnswering(on) {
    answering = on;
    stopButton.hidden = !on;
    sendButton.hidden = on;
  }

  let renaming = false; // the chat's name is being changed in the list: the list is not drawn over the box
  async function drawList() {
    let chats = [];
    try { chats = await assistantApi.list(); } catch { return; }
    if (renaming) return;
    list.replaceChildren(
      el('div', { class: 'chat-list-head' }, el('h2', { class: 'chat-list-title' }, 'Chats'), actions),
      ...(chats.length ? chats.map((c) => el('a', {
        class: 'chat-list-item', href: `/assistant/${c.id}`, ...(c.id === conversation?.id ? { 'aria-current': 'page' } : {}),
      }, el('span', { class: 'chat-list-name' }, c.title || 'New chat'))) : [el('p', { class: 'plan-empty' }, 'No chats yet.')]));
  }

  function drawThread() {
    const messages = conversation?.messages ?? [];
    const marks = conversation?.call_marks ?? {};
    // The lines where a call went on in writing (advanced/voice/7), each after the last message before it.
    const written = Object.values(marks).filter((m) => m.written);
    // A new chat shows only the box to ask in (2026-11-10, the owner's wish).
    // Which AI it began with, at the top, and a line wherever it changed (before the question it answered).
    const nodes = [];
    const writtenLine = () => el('p', { class: 'chat-switch chat-call-written' }, icon('phone'), 'The call went on in writing.');
    // A call that went on in writing before anything was said still leaves its line.
    for (const w of written.filter((x) => !messages.length || x.created_at < messages[0].created_at)) nodes.push(writtenLine(w));
    let last = '';
    let lastWords = ''; // the model named last, so a change of model (ai-pick) gets its line too
    for (const m of messages) {
      if (m.role === 'assistant' && AI_NAMES[m.ai]) {
        const words = aiLabel(m);
        if (!last) nodes.unshift(el('p', { class: 'chat-switch', 'data-ai': m.ai }, 'Started with ', aiChip(m.ai, words)));
        else if (m.ai !== last || (m.model && lastWords && words !== lastWords)) {
          const line = el('p', { class: 'chat-switch', 'data-ai': m.ai }, 'Switched to ', aiChip(m.ai, words));
          const at = nodes.length && nodes.at(-1).dataset.role === 'user' ? nodes.length - 1 : nodes.length;
          nodes.splice(at, 0, line);
        }
        if (m.model) lastWords = words;
        else if (m.ai !== last) lastWords = '';
        last = m.ai;
      }
      nodes.push(bubble(m, () => drawThread(), marks[m.id]));
      const next = messages[messages.indexOf(m) + 1];
      for (const w of written.filter((x) => x.created_at >= m.created_at && (!next || x.created_at < next.created_at))) {
        nodes.push(writtenLine(w));
      }
    }
    thread.replaceChildren(...nodes);
    thread.hidden = !nodes.length;
    thread.scrollTop = thread.scrollHeight;
    title.textContent = 'Assistant'; // always the section's name; the chat open is marked in the list (2026-11-11, the owner's wish)
    document.title = conversation?.title ? `Assistant · ${conversation.title}` : 'Assistant';
    actions.replaceChildren(...(conversation?.messages.length ? [
      el('button', { type: 'button', class: 'button button-quiet', 'aria-label': 'Rename chat', onclick: () => startRename() }, 'Rename'),
      el('button', { type: 'button', class: 'button button-quiet', 'aria-label': 'Delete chat', onclick: () => remove() }, 'Delete'),
    ] : []));
  }

  // Rename: the chat's name in the list turns into a box; Enter keeps the new name, Esc leaves it as it was.
  function startRename() {
    const name = list.querySelector('.chat-list-item[aria-current="page"] .chat-list-name');
    if (!name || !conversation) return;
    const box = el('input', { type: 'text', class: 'chat-rename', 'aria-label': 'Chat name', maxlength: 80, value: conversation.title || '' });
    let done = false;
    renaming = true;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      const wanted = box.value.trim();
      if (keep && wanted && wanted !== conversation.title) {
        try { conversation = { ...conversation, title: (await assistantApi.rename(conversation.id, wanted)).title }; } catch (err) { problem.textContent = err.message; }
      }
      renaming = false;
      drawThread();
      drawList();
    };
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    box.addEventListener('blur', () => finish(true));
    box.addEventListener('click', (event) => event.preventDefault());
    name.replaceChildren(box);
    box.focus();
    box.select();
  }

  // Which AI answers next, named in the box to ask in.
  request('GET', '/api/assistant/ai').then((state) => {
    chosen = state.provider;
    input.placeholder = `Ask your assistant (${AI_NAMES[chosen] ?? 'Claude'})`;
  }).catch(() => {});

  async function load(conversationId) {
    conversation = conversationId ? await assistantApi.get(conversationId) : null;
    drawThread();
    drawList();
    drawPick();
    setAnswering(Boolean(conversation?.answering));
    if (conversation?.answering) follow();
  }

  // An answer still under way (started before this page opened): look again until it ends.
  async function follow() {
    while (!left && conversation) {
      await new Promise((done) => setTimeout(done, 1000));
      if (left) return;
      const now = await assistantApi.get(conversation.id).catch(() => null);
      if (!now) return;
      conversation = now;
      drawThread();
      if (!now.answering) { setAnswering(false); return; }
    }
  }

  async function send(text, context = null, { onEvent = () => {} } = {}) {
    if (answering || !text.trim()) return null;
    problem.textContent = '';
    if (!conversation) {
      conversation = { ...(await assistantApi.create()), messages: [] };
      history.replaceState(null, '', `/assistant/${conversation.id}`);
      if (pickOn) await savePick(); // the choice made before the chat existed is now this chat's own
    }
    input.value = '';
    const asked = { role: 'user', text: text.trim(), context, created_at: new Date().toISOString(), steps: [] };
    const answer = { role: 'assistant', text: '', state: 'answering', ai: chosen, model: '', created_at: new Date().toISOString(), steps: [], sources: [], cards: [] };
    conversation.messages.push(asked, answer);
    conversation.title ||= asked.text.split('\n')[0].slice(0, 80);
    drawThread();
    drawList();
    setAnswering(true);
    let node = thread.lastElementChild;
    const redraw = () => {
      const next = bubble(answer, () => redraw());
      const open = node.querySelector('.chat-steps')?.open;
      if (open) next.querySelector('.chat-steps')?.setAttribute('open', '');
      node.replaceWith(next);
      node = next;
      thread.scrollTop = thread.scrollHeight;
    };
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...(context ? { context } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The assistant could not answer.');
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === 'text') answer.text += event.text;
          else if (event.type === 'step') answer.steps.push(event.step);
          else if (event.type === 'card') {
            const known = answer.cards.findIndex((c) => c.id === event.card.id);
            if (known >= 0) answer.cards[known] = event.card; else answer.cards.push(event.card);
          }
          else if (event.type === 'step_done') {
            const step = answer.steps.find((s) => s.id === event.id);
            if (step) step.state = event.error ? 'failed' : 'done';
          } else if (event.type === 'done') Object.assign(answer, event.message);
          onEvent(event, answer);
        }
        if (!left) redraw();
      }
    } catch (err) {
      problem.textContent = err.message;
      answer.state = 'failed';
      if (!left) redraw();
    }
    setAnswering(false);
    // Drawn again: the answer now names its model. While the chat's name is being changed, the list and the cursor stay
    // where they are (the box would vanish under the person's typing); the rename draws the list when it is done.
    if (!left) { drawThread(); if (!renaming) { drawList(); if (!call.active()) input.focus(); } }
    return answer;
  }

  async function stop() {
    if (conversation) await assistantApi.stop(conversation.id).catch(() => {});
  }

  async function remove() {
    const gone = conversation;
    await assistantApi.remove(gone.id);
    history.pushState(null, '', '/assistant');
    await load(null);
    undoPlace.replaceChildren(undoBar(`“${gone.title || 'New chat'}” deleted.`, async () => {
      await assistantApi.restore(gone.id);
      history.pushState(null, '', `/assistant/${gone.id}`);
      await load(gone.id);
    }));
  }

  try {
    await load(id);
    // A question from the Ask your notes box on another page.
    const asked = id ? null : takeQuestion();
    if (asked) { await send(asked.text, asked.context); return; }
  } catch {
    conversation = null;
    drawThread();
    drawList();
    problem.textContent = id ? 'That chat is not here (it may have been deleted).' : '';
  }
  input.focus();
}
