// Mail (/mail, advanced/mail/5): the app you work in. One list of every conversation, every account together or one at a time,
// sorted into six splits by rules you can read: Important, Calendar, Money, Newsletters, Other and Done. Open one and the line
// above it says which rule put it there. Importing and syncing are on /mail/import.

import { el, icon, request, shortDate, clockTime, undoBar, api, addDays } from './ui.js';
import { face } from './people.js';
import { app, screen, onLeave } from './shell.js';
import { moduleOn } from './modules.js';
import { mailRow, openedChip, outboxMailRow, outboxRow } from './mail.js';
import { framePolicy, suspiciousLinks, remoteImages, cleanForFrame } from './mail-safety.js';
import { openTaskModal } from './task-modal.js';
import { todayDay } from './due.js';

// Drafts, Sent and Outbox sit after the six: Drafts is every mail being written (saved as you type); Sent every conversation you
// wrote in; Outbox what has not gone yet (in its ten seconds, Send later, failed), shown only then.
// Two rows (2026-11-11, the owner's wish): Inbox, Drafts, Sent, (Outbox), Done; then the five splits, filters of the Inbox.
const VIEWS = [['inbox', 'Inbox'], ['drafts', 'Drafts'], ['sent', 'Sent'], ['outbox', 'Outbox'], ['done', 'Done']];
const FILTERS = [['important', 'Important'], ['calendar', 'Calendar'], ['money', 'Money'], ['news', 'Newsletters'], ['other', 'Other']];
const SPLITS = [...VIEWS, ...FILTERS];
const INBOX_SPLITS = new Set(['inbox', 'important', 'calendar', 'money', 'news', 'other', 'done']);
// The Sealed frame (Mail 7): a mail's own html shown with no permissions at all. Its scripts never run (no script permission, and a
// content policy that allows none); nothing is fetched from the network unless `images` says the sender's images may load; a
// link opens only after you press it, in a new tab, never inside the frame. The one thing the frame allows is that this page reads
// its height and handles its links: with no script permission nothing in it can run, with that allowed or not.
export function sealedFrame(html, { images = false, onLink = (href) => window.open(href, '_blank', 'noopener,noreferrer') } = {}) {
  const frame = el('iframe', { class: 'sealed-frame', title: 'The mail', sandbox: 'allow-same-origin', referrerpolicy: 'no-referrer', loading: 'eager' });
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${framePolicy(images)}"><base target="_blank"><style>body{font:14px/1.5 sans-serif;margin:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>${cleanForFrame(html, { images })}`;
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    frame.style.height = `${Math.min(4000, Math.max(80, doc.documentElement.scrollHeight + 4))}px`;
    doc.addEventListener('click', (event) => {
      const a = event.target.closest?.('a[href]');
      if (!a) return;
      event.preventDefault();
      if (/^https?:\/\//i.test(a.href)) onLink(a.href);
    });
  });
  return frame;
}

// The Mail composer: to, subject, the words, Send (the screen's one accent), Send later, and "remind me if no answer". `draft` fills it.
// A new mail (no conversation) also has Cc, and From when there is more than one account (`accounts`); `suggest` is a list of
// addresses from People, offered as you type To and Cc.
// onChange: called on every change (drafts save as you type); onDiscard: then the composer has Close (keeps the draft in Drafts) and Discard.
export function composer(draft = {}, { onSend = () => {}, onLater = () => {}, onCancel = () => {}, canSend = true, onAllow = () => {}, accent = true, accounts = null, suggest = [], label = 'Your answer', onChange = null, onDiscard = null, replyingTo = null } = {}) {
  const listId = suggest.length ? `mail-addresses-${Math.random().toString(36).slice(2, 8)}` : null;
  const addressBox = (name, value) => el('input', { class: 'detail-input', 'aria-label': name, value, autocomplete: 'off', spellcheck: 'false', ...(listId ? { list: listId } : {}) });
  const to = addressBox('To', (draft.to ?? []).join(', '));
  const hasCc = draft.cc !== undefined;
  const cc = hasCc ? addressBox('Cc', (draft.cc ?? []).join(', ')) : null;
  const from = accounts && accounts.length > 1 ? el('select', { class: 'detail-input', 'aria-label': 'From' },
    ...accounts.map((a) => el('option', { value: a.id, selected: a.id === draft.account_id }, a.email))) : null;
  const subject = el('input', { class: 'detail-input', 'aria-label': 'Subject', value: draft.subject ?? '', autocomplete: 'off' });
  const body = el('textarea', { class: 'detail-input mail-compose-body', 'aria-label': label, rows: 7, placeholder: label });
  body.value = draft.body ?? '';
  const remind = el('input', { type: 'checkbox', id: 'mail-remind-days' });
  remind.checked = Boolean(draft.remind_days);
  // A read confirmation: off unless you switch it on, remembered per person; it needs a public address for the picture.
  const confirm = el('input', { type: 'checkbox', id: 'mail-confirm', disabled: draft.pixel_ready === false });
  confirm.checked = Boolean(draft.confirm) && draft.pixel_ready !== false;
  const values = () => ({ to: to.value, ...(cc ? { cc: cc.value } : {}), ...(from ? { account_id: from.value } : draft.account_id ? { account_id: draft.account_id } : {}), subject: subject.value, body: body.value, remind_days: remind.checked ? 3 : 0, confirm: confirm.checked });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const allow = el('p', { class: 'mail-allow', role: 'status' }, 'Sending needs your OK for “Send mail as you”. Google is asked for that one permission only, now. ',
    el('button', { type: 'button', class: 'button', onclick: () => onAllow(values()) }, 'Allow sending'));
  const sendButton = el('button', { type: 'submit', class: `button${accent ? ' button-primary' : ''}`, 'aria-label': 'Send' }, keyHint('⌘↵', 'Send'));
  const laterButton = el('button', { type: 'button', class: 'button', onclick: () => onLater(values(), problem) }, 'Send later · tomorrow 08:00');
  const allowed = (ok) => { allow.hidden = ok; sendButton.disabled = !ok; laterButton.disabled = !ok; };
  if (from) from.addEventListener('change', () => allowed(Boolean(accounts.find((a) => a.id === from.value)?.can_send)));
  const startWords = body.value;
  const form = el('form', { class: 'mail-composer', 'aria-label': 'Write a mail', onsubmit: (event) => { event.preventDefault(); if (!sendButton.disabled) onSend(values(), problem); } },
    ...(replyingTo ? [el('p', { class: 'mail-replying-to', role: 'status' }, icon('back'), ' ', replyingTo.all ? 'Replying to all on the mail from ' : 'Replying to ',
      el('strong', {}, replyingTo.name), replyingTo.sent_at ? ` · ${shortDate(replyingTo.sent_at)} ${clockTime(replyingTo.sent_at)}` : '')] : []),
    ...(from ? [el('label', { class: 'detail-label' }, 'From'), from] : []),
    el('label', { class: 'detail-label' }, 'To'), to, ...(cc ? [el('label', { class: 'detail-label' }, 'Cc'), cc] : []),
    el('label', { class: 'detail-label' }, 'Subject'), subject, body,
    ...(listId ? [el('datalist', { id: listId }, ...suggest.map((s) => el('option', { value: s.email }, s.name)))] : []),
    el('label', { class: 'mail-remind-check' }, remind, ' Remind me if no answer in 3 days'),
    el('label', { class: 'mail-remind-check' }, confirm, ' Read confirmation'),
    el('p', { class: 'capture-hint' }, draft.pixel_ready === false ? 'A read confirmation needs a public address for its picture: set it under Import and sync. It only ever says “Opened”, never “Read”.' : 'Off unless you switch it on for this mail, and remembered for this person. It only ever says “Opened”, never “Read”.'),
    allow,
    el('div', { class: 'mail-compose-actions' }, sendButton, laterButton,
      ...(onDiscard
        ? [el('button', { type: 'button', class: 'button button-quiet', title: 'Close: the draft waits in Drafts (Esc)', onclick: onCancel }, 'Close'),
          el('button', { type: 'button', class: 'button button-quiet', onclick: onDiscard }, 'Discard')]
        : [el('button', { type: 'button', class: 'button button-quiet', onclick: onCancel }, hasCc ? 'Discard' : 'Cancel')])),
    ...(onDiscard ? [el('p', { class: 'capture-hint mail-draft-status', role: 'status' }, '')] : []), problem);
  allowed(canSend);
  if (onChange) { form.addEventListener('input', () => onChange(values())); form.addEventListener('change', () => onChange(values())); }
  form.saved = (words) => form.querySelector('.mail-draft-status')?.replaceChildren(words);
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
  });
  form.values = values;
  form.focusBody = () => { body.focus(); body.setSelectionRange?.(0, 0); body.scrollTop = 0; }; // a quoted mail waits below: you write above it
  form.focusTo = () => to.focus();
  form.isEmpty = () => !to.value.trim() && !subject.value.trim() && !body.value.trim();
  form.hasWords = () => Boolean(body.value.trim());
  form.changed = () => body.value !== startWords; // you wrote something (more than the quote it started with)
  return form;
}

// An invitation in a mail (Mail 12): what the meeting is, and three keys. Once answered it says what happened, in words.
const longDay = (start) => { const [y, m, d] = start.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); };
export function inviteWhen(card) { return card.all_day ? `${longDay(card.start)}, all day` : `${longDay(card.start)}, ${card.start.slice(11)} to ${card.end.slice(11)}`; }
export function inviteCard(card, { onAnswer = () => {}, onUndo = () => {} } = {}) {
  const who = card.organizer.name || card.organizer.email;
  const a = card.answer;
  const status = card.cancelled ? 'The organiser cancelled this meeting.'
    : a ? [`You said ${a.said}`, a.in_calendar ? 'in your Calendar' : 'not on your Calendar',
      !a.send ? 'no answer was sent: it has no address to answer to'
        : a.send.state === 'sent' ? `${a.word} sent by mail`
          : a.send.state === 'failed' ? `${a.word} did not go: ${a.send.problem}`
            : a.send.state === 'undone' ? `${a.word} taken back`
              : a.send.problem ? a.send.problem : `${a.word} goes by mail in a few seconds`].join(' · ') : '';
  const undoable = a?.send && a.send.state === 'waiting';
  return el('section', { class: 'invite-card', 'aria-label': `Invitation: ${card.summary}`, 'data-state': card.cancelled ? 'cancelled' : a ? a.said.toLowerCase() : 'open' },
    el('p', { class: 'invite-title' }, icon('calendar'), el('strong', {}, card.summary)),
    el('p', { class: 'invite-when' }, inviteWhen(card)),
    ...(card.location ? [el('p', { class: 'invite-place' }, `At ${card.location}`)] : []),
    el('p', { class: 'invite-from' }, `From ${who}${card.attendees.length > 1 ? ` · ${card.attendees.length} invited` : ''}`),
    ...(card.cancelled ? [] : [el('div', { class: 'invite-keys', role: 'group', 'aria-label': 'Your answer' },
      ...[['yes', 'Yes', 'y'], ['maybe', 'Maybe', '⇧Y'], ['no', 'No', 'n']].map(([id, label, key]) => el('button', {
        type: 'button', class: 'button', 'aria-pressed': String(a?.said === label), 'data-answer': id, onclick: () => onAnswer(id),
      }, keyHint(key, label))))]),
    ...(status ? [el('p', { class: 'invite-status', role: 'status' }, status, ...(undoable ? [' ', el('button', { type: 'button', class: 'button button-quiet', onclick: onUndo }, 'Undo')] : []))] : []));
}

// Who is in a conversation (Mail 10): the person behind each address and their company, or the one key that adds a stranger to People.
export function peopleCards(cards, { onAdd = null } = {}) {
  const node = (c) => el('div', { class: 'mail-person', 'data-email': c.email },
    c.person
      ? el('a', { class: 'mail-person-card', href: `/people/${c.person.id}` }, face('person', c.person.name), el('span', { class: 'mail-person-text' }, el('strong', {}, c.person.name), el('span', {}, c.person.role || c.email)))
      : el('span', { class: 'mail-person-card is-unknown' }, face('person', c.name || c.email), el('span', { class: 'mail-person-text' }, el('strong', {}, c.name || c.email), el('span', {}, `Not in People yet · ${c.email}`)),
        ...(onAdd ? [el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Add ${c.name || c.email} to People`, onclick: () => onAdd(c) }, keyHint('⇧P', 'Add'))] : [])),
    c.company ? el('a', { class: 'mail-company-card', href: `/companies/${c.company.id}` }, face('company', c.company.name), el('span', {}, c.company.name)) : null);
  return el('div', { class: 'mail-people', role: 'list', 'aria-label': 'People in this conversation' }, ...cards.map((c) => el('div', { role: 'listitem' }, node(c))));
}

// The Key hint: a key beside the action it does. The palette and the panel teach the keys with it.
export const keyHint = (key, label) => el('span', { class: 'key-hint' }, label ? el('span', {}, label) : null, el('kbd', { class: 'sidebar-key' }, key));

// The keys, as one table: each key, what it does, and (until a later lesson) whether it is there yet.
export const MAIL_KEYS = [
  { key: 'j', id: 'next', name: 'Next conversation' },
  { key: 'k', id: 'previous', name: 'Previous conversation' },
  { key: 'e', id: 'done', name: 'Done: out of the Inbox' },
  { key: '#', id: 'delete', name: 'Delete: to Gmail’s Trash (also d)' },
  { key: 'h', id: 'remind', name: 'Remind me' },
  { key: 'c', id: 'new', name: 'New email' },
  { key: 'r', id: 'reply', name: 'Reply' },
  { key: 't', id: 'task', name: 'Make a task of it' },
  { key: 'y', id: 'yes', name: 'Invitation: Yes' },
  { key: '⇧Y', id: 'maybe', name: 'Invitation: Maybe' },
  { key: 'n', id: 'no', name: 'Invitation: No' },
  { key: '⇧P', id: 'addsender', name: 'Add the sender to People' },
  { key: '?', id: 'times', name: 'Show each key with its time' },
];
export const KEY_LIMIT_MS = 50;
const pad2 = (n) => String(n).padStart(2, '0');
const roundTo15 = (d) => { d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return d; };

// Remind me: later today (three hours on, to the quarter hour; after 18:00 it is tomorrow morning), tomorrow, next week (Monday).
export function remindChoices(now = new Date()) {
  const day = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const later = roundTo15(new Date(now.getTime() + 3 * 3_600_000));
  const todayOk = later.getDate() === now.getDate() && later.getHours() < 20;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now); monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  return [
    ...(todayOk ? [{ id: 'later', name: 'Later today', due: day(later), time: `${pad2(later.getHours())}:${pad2(later.getMinutes())}` }] : []),
    { id: 'tomorrow', name: 'Tomorrow', due: day(tomorrow), time: '09:00' },
    { id: 'week', name: 'Next week', due: day(monday), time: '09:00' },
  ];
}

const address = (a) => (a.name ? `${a.name} <${a.email}>` : a.email);

// The split tabs, in two rows (2026-11-11, the owner's wish): Inbox, Drafts, Sent, Outbox (only while something has not gone; failed:
// “Outbox · failed”) and Done alone on the first row; a thin grey line; the five splits of the Inbox as small capsules on the second;
// then a thick dark line before the list. Each tab has its count. A list too narrow lets the second row wrap; nothing ever scrolls
// sideways. A Tabs piece (the Tasks page's look); shown here for the Library as well.
export function splitTabs({ counts = {}, current = 'inbox', onPick = () => {}, failed = 0 } = {}) {
  const tab = ([id, name]) => el('button', {
    type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(id === current), 'data-split': id, onclick: () => onPick(id),
    ...(id === 'outbox' && failed ? { title: `${failed} did not go` } : {}),
  }, name, counts[id] ? el('span', { class: 'tab-count' }, id === 'outbox' && failed ? `${counts[id]} · ${failed} failed` : String(counts[id])) : null);
  return el('div', { class: 'mail-splits', role: 'tablist', 'aria-label': 'Splits' },
    el('div', { class: 'mail-splits-row mail-views', role: 'presentation' }, ...VIEWS.filter(([id]) => id !== 'outbox' || counts.outbox || current === 'outbox').map(tab)),
    el('div', { class: 'mail-splits-row mail-filters', role: 'presentation' }, ...FILTERS.map(tab)));
}

// The divider between the list and the conversation: how wide the list is, kept in this browser.
export const LIST_WIDTH = { key: 'mail.listWidth', initial: 400, min: 280, max: 720, step: 16 };
export const clampListWidth = (px, room = Infinity) => Math.round(Math.max(LIST_WIDTH.min, Math.min(LIST_WIDTH.max, room * 0.6, px)));
function savedListWidth() {
  try { const n = Number(localStorage.getItem(LIST_WIDTH.key)); return n > 0 ? n : LIST_WIDTH.initial; } catch { return LIST_WIDTH.initial; }
}
function listDivider(layout) {
  const room = () => layout.getBoundingClientRect().width || Infinity;
  const divider = el('div', { class: 'mail-divider', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Width of the list', 'aria-valuemin': String(LIST_WIDTH.min), 'aria-valuemax': String(LIST_WIDTH.max), title: 'Drag to change the width of the list · double-click to reset' });
  const set = (px, keep = false) => {
    const w = clampListWidth(px, room());
    app.style.setProperty('--mail-list-width', `${w}px`);
    divider.setAttribute('aria-valuenow', String(w));
    if (keep) { try { localStorage.setItem(LIST_WIDTH.key, String(w)); } catch { /* not kept, still set */ } }
    return w;
  };
  const now = () => Number(divider.getAttribute('aria-valuenow')) || LIST_WIDTH.initial;
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const x0 = event.clientX;
    const w0 = now();
    divider.setPointerCapture(event.pointerId);
    divider.classList.add('is-dragging');
    const moveTo = (e) => set(w0 + e.clientX - x0);
    const end = (e) => { set(w0 + e.clientX - x0, true); divider.classList.remove('is-dragging'); divider.removeEventListener('pointermove', moveTo); divider.removeEventListener('pointerup', end); divider.removeEventListener('pointercancel', end); };
    divider.addEventListener('pointermove', moveTo);
    divider.addEventListener('pointerup', end);
    divider.addEventListener('pointercancel', end);
  });
  divider.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? LIST_WIDTH.step * 4 : LIST_WIDTH.step;
    const to = { ArrowLeft: now() - step, ArrowRight: now() + step, Home: LIST_WIDTH.min, End: LIST_WIDTH.max }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    set(to, true);
  });
  divider.addEventListener('dblclick', () => set(LIST_WIDTH.initial, true));
  divider.place = () => set(savedListWidth());
  return divider;
}

export async function showMailApp() {
  document.title = 'Mail';
  app.className = 'page page-wide mail-app-page';
  onLeave(() => app.style.removeProperty('--mail-list-width'));
  if (!moduleOn('mail')) {
    screen.replaceChildren(
      el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Mail')),
      el('p', { class: 'empty' }, 'Mail is switched off. Everything it kept is still here. ', el('a', { href: '/settings' }, 'Switch it on in Settings.')));
    return;
  }
  const params = new URLSearchParams(location.search);
  let split = SPLITS.some(([id]) => id === params.get('split')) ? params.get('split') : 'inbox';
  let accountId = params.get('account') ?? '';
  let openId = params.get('thread') ?? '';
  let accounts = [];
  let counts = {};
  let failed = 0; // how many in the Outbox did not go
  let load = 0;
  let shown = []; // the conversations in the list, in order
  let openToken = 0;
  const times = new Map(); // key id → the last fifty times, in ms
  const undoPlace = el('div', { class: 'mail-undo' });
  const remindPlace = el('div', { class: 'mail-remind-place' }); // the Remind me menu lives outside the reader, which is drawn again when a conversation loads
  // Every key is timed: from the press to the screen having changed. The work behind it (the outbox, Gmail) comes after.
  const timed = (id, change) => {
    const t0 = performance.now();
    change();
    const ms = performance.now() - t0;
    const list_ = times.get(id) ?? [];
    list_.push(ms);
    times.set(id, list_.slice(-50));
    app.dataset.lastKeyMs = ms.toFixed(2);
    return ms;
  };

  const switchBar = el('div', { class: 'mail-accounts', role: 'group', 'aria-label': 'Account' });
  const tabs = el('div', { class: 'mail-tabs' });
  const list = el('div', { class: 'mail-threads', role: 'list', 'aria-label': 'Conversations' });
  const reader = el('section', { class: 'mail-reader', 'aria-label': 'Conversation' });
  const composePlace = el('div', { class: 'mail-compose-place' }); // outside the reader, which is drawn again when a conversation loads
  const layout = el('div', { class: 'mail-layout' });
  const divider = listDivider(layout);
  const readerCol = el('div', { class: 'mail-reader-col' }, reader, composePlace);
  layout.append(el('div', { class: 'mail-list-panel' }, switchBar, tabs, list), divider, readerCol);
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Mail'),
      el('button', { type: 'button', class: 'button button-primary page-add', title: 'New email (c)', onclick: () => composeNew() }, icon('plus'), 'New email'),
      el('a', { class: 'button button-quiet mail-import-link', href: '/mail/import' }, icon('mail'), 'Import and sync')),
    remindPlace, layout, undoPlace);
  divider.place();

  const drawTabs = () => tabs.replaceChildren(splitTabs({ counts, failed, current: split, onPick: (id) => { split = id; openId = ''; refresh(); } }));
  const keep = () => history.replaceState(null, '', `/mail?${new URLSearchParams({ split, ...(accountId ? { account: accountId } : {}), ...(openId ? { thread: openId } : {}) })}`);

  function drawSwitch() {
    switchBar.hidden = accounts.length < 2;
    switchBar.replaceChildren(...[{ id: '', email: 'All', letter: null }, ...accounts.map((a) => ({ id: a.id, email: a.email, letter: a.email[0].toUpperCase() }))].map((a) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(a.id === accountId), title: a.id ? a.email : 'Every account together',
      onclick: () => { accountId = a.id; openId = ''; refresh(); },
    }, a.letter ? el('span', { class: 'mail-letter' }, a.letter) : null, a.id ? ` ${a.email}` : 'All accounts')));
  }

  async function refresh() {
    const mine = ++load;
    keep();
    let data;
    try { data = await request('GET', `/api/mail/inbox?${new URLSearchParams({ split, ...(accountId ? { account: accountId } : {}), limit: '100' })}`); } catch (err) {
      if (mine !== load) return;
      // The server answered but refused (an app updated while its server still runs older code says so here): say what it said.
      list.replaceChildren(el('p', { class: 'empty' }, err.status
        ? `Mail couldn't be loaded: ${err.message} If the app was just updated, restart it.`
        : "Mail couldn't be loaded. Is the app still running?"));
      return;
    }
    if (mine !== load) return;
    counts = data.counts;
    failed = data.outbox_failed ?? 0;
    drafts = data.outbox.drafts;
    drawTabs();
    drawSwitch();
    soon = data.outbox.changes.length > 0 || data.outbox.sends.some((x) => x.state === 'sending' || (x.state === 'waiting' && new Date(x.send_at) - Date.now() < 60_000));
    watchOutbox();
    if (split === 'outbox' || split === 'drafts') { shown = []; drawOutbox(data.outbox); return; }
    const total = SPLITS.filter(([id]) => INBOX_SPLITS.has(id)).reduce((a, [id]) => a + (counts[id] ?? 0), 0);
    shown = data.threads;
    list.replaceChildren(...(data.threads.length
      ? data.threads.map((t) => mailRow(t, { current: t.id === openId, onOpen: (thread) => select(thread) }))
      : [el('p', { class: 'empty' }, total ? `Nothing in ${SPLITS.find(([id]) => id === split)[1]}.` : el('span', {}, 'No mail yet. ', el('a', { href: '/mail/import' }, 'Import your Gmail history'), '.'))]));
    layout.classList.toggle('is-open', Boolean(openId));
    if (openId) open(openId); else if (newMail) layout.classList.add('is-open'); else reader.replaceChildren(el('p', { class: 'empty' }, 'Open a conversation to read it. The line above it says why it is where it is.'));
  }

  // Drafts: every mail being written, kept as you type (in this database only). The latest list comes with every refresh.
  let drafts = [];
  const draftBase = (d) => ({ draft_id: d.id, account_id: d.account_id, thread_id: d.thread_id, to: d.to, ...(d.thread_id && !String(d.cc ?? '').trim() ? {} : { cc: d.cc }), subject: d.subject, body: d.body, remind_days: d.remind_days, confirm: d.confirm });
  async function continueDraft(d) {
    if (composerNode) { await composerNode.settle?.(); closeComposer(); }
    if (d.thread_id) { openId = d.thread_id; keep(); await open(openId); await compose(draftBase(d)); } else await composeNew({ ...draftBase(d), fresh: true });
  }
  const firstWords = (t) => { const w = String(t ?? '').replace(/\s+/g, ' ').trim(); return w.length > 90 ? `${w.slice(0, 90)}…` : w; };
  // The counts again (after a draft is made, closed or discarded), without drawing the list again.
  async function countsAgain() {
    if (split === 'outbox' || split === 'drafts') { refresh(); return; }
    let data;
    try { data = await request('GET', `/api/mail/inbox?${new URLSearchParams({ split: 'outbox', ...(accountId ? { account: accountId } : {}) })}`); } catch { return; }
    counts = { ...counts, outbox: data.counts.outbox, sent: data.counts.sent, drafts: data.counts.drafts };
    failed = data.outbox_failed ?? 0;
    drafts = data.outbox.drafts;
    drawTabs();
  }

  // The Outbox: what has not gone yet. A mail in its ten seconds (Undo), one waiting for Send later (Send now, Cancel), one that
  // failed (Try again, Let it go), and label changes Gmail did not take. The words say where each is; nothing goes again by itself.
  const act = async (path, problemAt) => {
    try { await request('POST', path, {}); } catch (err) { problemAt?.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, err.message)); }
    await refresh();
  };
  function drawOutbox(outbox) {
    layout.classList.toggle('is-open', Boolean(openId) || newMail);
    const isDrafts = split === 'drafts';
    if (!openId && !newMail) reader.replaceChildren(el('p', { class: 'empty' }, isDrafts
      ? 'A mail you are writing is saved here as you type, in this app only. Continue writing, send it, or discard it.'
      : 'Mail waits here until it has gone: ten seconds to undo, or until the time you chose. A mail that did not go stays here until you send it again or let it go.'));
    if (isDrafts && !outbox.drafts.length) { list.replaceChildren(el('p', { class: 'empty' }, 'No drafts. A mail you start writing is kept here as you type.')); return; }
    if (!isDrafts && !outbox.sends.length && !outbox.changes.length) { list.replaceChildren(el('p', { class: 'empty' }, 'Nothing waiting to go. Everything you wrote has gone.')); return; }
    const button = (label, onclick, cls = 'button button-quiet') => el('button', { type: 'button', class: cls, onclick }, label);
    const draftRow = (d) => {
      const row = el('div', { class: 'outbox-row is-mail is-draft', role: 'listitem', 'data-state': 'draft', 'data-draft': d.id },
        el('span', { class: 'outbox-what' }, el('span', { class: 'outbox-draft-mark' }, icon('edit'), ' Draft'), ` · ${d.to ? `To ${d.to}` : 'No one yet'}${d.thread_id ? ' · a reply' : ''}`),
        el('span', { class: 'outbox-subject' }, d.subject || '(no subject)'),
        el('span', { class: 'outbox-state' }, firstWords(d.body) || 'No words yet', ` · ${shortDate(d.updated_at)} ${clockTime(d.updated_at)}`),
        el('span', { class: 'outbox-actions' },
          button('Continue writing', () => continueDraft(d)),
          button('Discard', async () => {
            await request('DELETE', `/api/mail/unsent/${d.id}`).catch(() => {});
            if (composerNode && drafts.some((x) => x.id === d.id)) { /* the open composer keeps its words; its next change saves a new draft */ }
            undoPlace.replaceChildren(undoBar('Draft discarded.', async () => { await request('POST', `/api/mail/unsent/${d.id}/restore`, {}); await refresh(); }));
            refresh();
          })));
      return row;
    };
    const sendRow = (x) => {
      const row = outboxMailRow(x, x.state === 'failed'
        ? [button('Try again', () => act(`/api/mail/sends/${x.id}/retry`, row)), button('Let it go', () => act(`/api/mail/sends/${x.id}/dismiss`, row))]
        : x.state === 'waiting' ? [
          ...(new Date(x.send_at) - Date.now() > 60_000 ? [button('Send now', () => act(`/api/mail/sends/${x.id}/send-now`, row))] : []),
          button(new Date(x.send_at) - Date.now() > 60_000 ? 'Cancel' : 'Undo', async () => {
            try {
              await request('POST', `/api/mail/sends/${x.id}/undo`, {});
              // The words come back in the composer, as with the Undo bar.
              const back = { account_id: x.account_id, to: x.to, subject: x.subject, body: x.body, remind_days: x.remind_days, confirm: x.confirm };
              // Taken back: it is a draft again.
              const again = (await request('POST', '/api/mail/unsent', { ...back, ...(x.thread_id ? { thread_id: x.thread_id } : { cc: x.cc }), confirm: Boolean(x.confirm) }).catch(() => ({}))).draft;
              if (again) back.draft_id = again.id;
              await refresh();
              if (x.thread_id) { openId = x.thread_id; keep(); await open(openId); compose(back); } else composeNew({ ...back, cc: x.cc, fresh: true });
            } catch (err) { row.append(el('p', { class: 'capture-problem', role: 'alert' }, err.message)); refresh(); }
          })] : []);
      return row;
    };
    if (isDrafts) { list.replaceChildren(...outbox.drafts.map(draftRow)); return; }
    list.replaceChildren(
      ...(outbox.sends.length ? [el('p', { class: 'mail-outbox-part' }, 'Mail on its way'), ...outbox.sends.map(sendRow)] : []),
      ...(outbox.changes.length ? [el('p', { class: 'mail-outbox-part' }, 'Changes Gmail has not taken yet'), ...outbox.changes.map((c) => {
        const row = outboxRow(c, c.state === 'failed' ? [button('Try again', () => act(`/api/mail/outbox/${c.id}/retry`, row)), button('Let it go', () => act(`/api/mail/outbox/${c.id}/dismiss`, row))] : [button('Let it go', () => act(`/api/mail/outbox/${c.id}/dismiss`, row))]);
        row.classList.add('is-mail');
        return row;
      })] : []));
  }
  // While something waits, look again: every second on the Outbox (the seconds count down), else only the counts, and only while
  // a mail is due within a minute, so the Outbox tab goes when the mail has gone and Sent gets it.
  let outboxTimer = null;
  let soon = false; // a mail in the Outbox goes within a minute (or a change waits)
  function watchOutbox() {
    clearTimeout(outboxTimer);
    if (!counts.outbox || (!soon && split !== 'outbox')) return;
    outboxTimer = setTimeout(async () => {
      if (split === 'outbox') { refresh(); return; }
      let data;
      try { data = await request('GET', `/api/mail/inbox?${new URLSearchParams({ split: 'outbox', ...(accountId ? { account: accountId } : {}) })}`); } catch { return; }
      const before = counts.outbox;
      counts = { ...counts, outbox: data.counts.outbox, sent: data.counts.sent, drafts: data.counts.drafts };
      failed = data.outbox_failed ?? 0;
      drafts = data.outbox.drafts;
      soon = data.outbox.changes.length > 0 || data.outbox.sends.some((x) => x.state === 'sending' || (x.state === 'waiting' && new Date(x.send_at) - Date.now() < 60_000));
      drawTabs();
      if (split === 'sent' && data.counts.outbox < before) refresh(); else watchOutbox();
    }, split === 'outbox' ? (soon ? 1000 : 30_000) : 3000);
  }
  onLeave(() => clearTimeout(outboxTimer));

  // Shift P: the sender who is not in People becomes a person, marked From a mail.
  let openThreadData = null;
  async function addToPeople(card, thread) {
    try {
      const made = await request('POST', '/api/mail/people', { email: card.email, name: card.name, subject: thread.subject });
      undoPlace.replaceChildren(undoBar(`${made.person.name} is in People${made.created ? ', from a mail' : ' already'}.`, async () => {}));
      await open(thread.id);
    } catch (err) { undoPlace.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, err.message)); }
  }

  // Select a conversation: the row, and the reader at once (its subject and first line from the list), the text after.
  function select(thread) {
    if (newMail && !leaveNew()) return;
    openId = thread.id;
    keep();
    layout.classList.add('is-open');
    list.querySelectorAll('.mail-row-open').forEach((row) => row.setAttribute('aria-current', String(row.dataset.thread === thread.id)));
    list.querySelector(`.mail-row-open[data-thread="${thread.id}"]`)?.scrollIntoView({ block: 'nearest' });
    reader.replaceChildren(el('h2', { class: 'mail-reader-subject' }, thread.subject || '(no subject)'), el('p', { class: 'mail-snippet' }, thread.snippet));
    open(thread.id);
  }

  const indexOfOpen = () => shown.findIndex((t) => t.id === openId);
  function move(delta) {
    if (!shown.length) return;
    const at = indexOfOpen();
    const next = shown[Math.max(0, Math.min(shown.length - 1, at < 0 ? (delta > 0 ? 0 : shown.length - 1) : at + delta))];
    timed(delta > 0 ? 'next' : 'previous', () => select(next));
  }

  // Done (e): the row leaves the list and the next one opens in the same moment; the outbox and Gmail come after, with Undo.
  function done() {
    const at = indexOfOpen();
    if (at < 0) return;
    if (split === 'done') { undoPlace.replaceChildren(undoBar('It is Done already.', async () => {})); return; }
    if (!INBOX_SPLITS.has(split)) { undoPlace.replaceChildren(undoBar('Done takes a conversation out of the Inbox: open it from its split.', async () => {})); return; }
    const gone = shown[at];
    timed('done', () => {
      list.querySelector(`.mail-row-open[data-thread="${gone.id}"]`)?.remove();
      shown = shown.filter((t) => t.id !== gone.id);
      counts = { ...counts, [split]: Math.max(0, (counts[split] ?? 1) - 1), done: (counts.done ?? 0) + 1 };
      drawTabs();
      const next = shown[Math.min(at, shown.length - 1)];
      if (next) select(next); else { openId = ''; layout.classList.remove('is-open'); reader.replaceChildren(el('p', { class: 'empty' }, `Nothing more in ${SPLITS.find(([id]) => id === split)[1]}.`)); keep(); }
    });
    request('POST', `/api/mail/threads/${gone.id}/done`, {}).then((res) => {
      undoPlace.replaceChildren(undoBar(`“${gone.subject || '(no subject)'}” is Done.`, async () => { await request('POST', `/api/mail/threads/${gone.id}/undo-done`, { messages: res.messages }); await refresh(); }));
    }).catch(() => { undoPlace.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, "That didn't go through. Is the app still running?")); refresh(); });
  }

  // Delete (# or d): like Done, the row leaves and the next one opens at once; every mail of it goes to Gmail's Trash (30 days
  // there, never deleted for good) and is hidden here. No question first: Undo puts it back.
  function trash() {
    const at = indexOfOpen();
    if (at < 0) return;
    const gone = shown[at];
    timed('delete', () => {
      list.querySelector(`.mail-row-open[data-thread="${gone.id}"]`)?.remove();
      shown = shown.filter((t) => t.id !== gone.id);
      counts = { ...counts, [split]: Math.max(0, (counts[split] ?? 1) - 1) };
      drawTabs();
      const next = shown[Math.min(at, shown.length - 1)];
      if (next) select(next); else { openId = ''; layout.classList.remove('is-open'); reader.replaceChildren(el('p', { class: 'empty' }, `Nothing more in ${SPLITS.find(([id]) => id === split)[1]}.`)); keep(); }
    });
    request('POST', `/api/mail/threads/${gone.id}/trash`, {}).then((res) => {
      undoPlace.replaceChildren(undoBar(`“${gone.subject || '(no subject)'}” is Deleted.`, async () => { await request('POST', `/api/mail/threads/${gone.id}/undo-trash`, { messages: res.messages, inbox: res.inbox }); await refresh(); }));
    }).catch(() => { undoPlace.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, "That didn't go through. Is the app still running?")); refresh(); });
  }

  // Reply (r): the composer opens under the last message, to and subject set. Sending waits ten seconds, with Undo; the first time,
  // Google is asked for the one permission it did not need until now.
  let composerNode = null;
  let newMail = false; // the composer holds a new mail, with no conversation
  const draftKey = (id) => `mail-draft:${id || 'new'}`;
  let composing = false;
  let suggestions = null; // the addresses in People, for To and Cc
  async function addressSuggestions() {
    if (suggestions) return suggestions;
    try {
      const people = await request('GET', '/api/people');
      suggestions = people.flatMap((p) => String(p.emails ?? '').split(/[,;\s]+/).filter((e) => e.includes('@')).map((email) => ({ email, name: p.name })));
    } catch { suggestions = []; }
    return suggestions;
  }
  // A new mail closes only when it is empty, or you say so: its words are never lost by opening a conversation.
  function leaveNew() {
    if (composerNode && !composerNode.isEmpty()) { composerNode.focusTo(); return false; }
    closeComposer();
    return true;
  }
  // The mail being answered has a crimson edge, so it is plain which one of the conversation the answer is to.
  function markReplying(messageId) {
    reader.querySelectorAll('.mail-message').forEach((a) => a.classList.toggle('is-replying', Boolean(messageId) && a.dataset.message === messageId));
  }
  function closeComposer() {
    composerNode?.remove();
    composerNode = null;
    markReplying('');
    if (newMail) {
      newMail = false;
      if (!openId) { layout.classList.remove('is-open'); reader.replaceChildren(el('p', { class: 'empty' }, 'Open a conversation to read it. The line above it says why it is where it is.')); }
    }
  }
  // New email (c, the New email button, Cmd K): the composer with no conversation behind it: To, Cc, Subject, the words.
  async function composeNew(draft = null) {
    if (composing) return;
    if (composerNode) {
      if (newMail || composerNode.hasWords()) { composerNode.focusTo(); return; }
      closeComposer();
    }
    if (openId) { openId = ''; openThreadData = null; keep(); list.querySelectorAll('.mail-row-open').forEach((row) => row.setAttribute('aria-current', 'false')); }
    newMail = true;
    layout.classList.add('is-open');
    reader.replaceChildren(
      el('a', { class: 'back-link mail-back', href: `/mail?split=${split}`, onclick: (event) => { event.preventDefault(); if (leaveNew()) refresh(); } }, icon('back'), 'Mail'),
      el('h2', { class: 'mail-reader-subject' }, 'New email'));
    await compose(draft ?? { fresh: true });
  }

  // pick: { message, all }: the Reply / Reply all on one mail of the conversation; its words come quoted, and the composer says whose.
  async function compose(draft = null, pick = null) {
    const fresh = Boolean(draft?.fresh) || (newMail && !openId);
    const id = fresh ? '' : openId;
    if (pick && composerNode && !fresh) {
      if (composerNode.changed?.()) { composerNode.querySelector('.capture-problem')?.replaceChildren('You are writing an answer already: send it, or Close it first (it waits in Drafts).'); composerNode.focusBody(); return; }
      if (composing) return;
      closeComposer();
    }
    if ((!id && !fresh) || composerNode || composing) return;
    composing = true;
    let mailAccounts;
    try { mailAccounts = (await request('GET', '/api/mail')).accounts; } catch { composing = false; return; }
    let base;
    if (fresh) {
      if (!mailAccounts.length) {
        composing = false;
        reader.append(el('p', { class: 'empty' }, 'There is no mail account yet. ', el('a', { href: '/mail/import' }, 'Import your Gmail history or sign in with Google'), ' first.'));
        return;
      }
      const chosen = mailAccounts.find((a) => a.id === (draft?.account_id || accountId)) ?? mailAccounts.find((a) => a.can_send) ?? mailAccounts[0];
      const pixel = await request('GET', '/api/mail/confirmations').catch(() => ({ base: '' }));
      base = { account_id: chosen.id, to: [], cc: [], subject: '', body: '', pixel_ready: Boolean(pixel.base), ...(draft ?? {}) };
      delete base.fresh;
    } else {
      // r on a conversation that has a draft continues it.
      const kept = draft ? null : drafts.find((d) => d.thread_id === id) ?? (await request('GET', '/api/mail/unsent').catch(() => [])).find((d) => d.thread_id === id);
      const ask = pick ? `?${new URLSearchParams({ message: pick.message, ...(pick.all ? { all: '1' } : {}) })}` : '';
      try { base = draft ?? (kept ? draftBase(kept) : await request('GET', `/api/mail/threads/${id}/reply${ask}`)); } catch { composing = false; return; }
      if (kept) base.pixel_ready = (await request('GET', `/api/mail/threads/${id}/reply`).catch(() => ({}))).pixel_ready;
    }
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(draftKey(id)) ?? 'null'); sessionStorage.removeItem(draftKey(id)); } catch { /* none */ }
    const words = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/).filter(Boolean));
    const withCc = fresh || base.cc !== undefined;
    const start = { ...base, ...(saved ?? {}), to: words(saved ? saved.to : base.to), ...(withCc ? { cc: words(saved ? saved.cc : base.cc) } : {}) };
    const accountOf = (values) => values.account_id || start.account_id;
    const mailAccount = mailAccounts.find((a) => a.id === start.account_id);
    // The draft: saved as you type (a short pause after the last key), one save at a time, so nothing typed is lost on a reload.
    let draftId = base.draft_id ?? null;
    let saveTimer = null;
    let saving = Promise.resolve();
    const saveNow = (values) => {
      clearTimeout(saveTimer);
      saving = saving.then(async () => {
        const was = draftId;
        try {
          const res = await request('POST', '/api/mail/unsent', { id: draftId, account_id: accountOf(values), ...(fresh ? {} : { thread_id: id }), to: values.to, cc: values.cc ?? '', subject: values.subject, body: values.body, remind_days: values.remind_days, confirm: values.confirm });
          draftId = res.draft?.id ?? null;
          drafts = [...drafts.filter((d) => d.id !== was && d.id !== draftId), ...(res.draft ? [res.draft] : [])];
          if (!was && draftId) countsAgain(); // a new draft: the Outbox tab shows
          node?.saved(res.draft ? `Draft saved ${clockTime(res.draft.updated_at)} · it waits in Drafts` : '');
        } catch { node?.saved('The draft could not be saved. Is the app still running?'); }
      });
      return saving;
    };
    const settle = async () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await saveNow(node.values()); } await saving; };
    const put = async (values, when) => {
      await settle();
      return request('POST', '/api/mail/sends', { account_id: accountOf(values), cc: values.cc ?? '', ...(fresh ? {} : { thread_id: id }), to: values.to, subject: values.subject, body: values.body, remind_days: values.remind_days, confirm: values.confirm, ...(base.card_id ? { card_id: base.card_id } : {}), ...(draftId ? { draft_id: draftId } : {}), when });
    };
    let node = null;
    composerNode = node = composer(start, {
      canSend: Boolean(mailAccount?.can_send),
      accent: false, // New email in the top bar is the screen's one accent
      accounts: fresh ? mailAccounts : null,
      suggest: fresh ? await addressSuggestions() : [],
      label: fresh ? 'Your mail' : 'Your answer',
      replyingTo: fresh ? null : base.replying_to ?? null,
      onChange: () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; saveNow(node.values()); }, 600); },
      // Close (or Escape): the draft is kept and waits in Drafts.
      onCancel: async () => { await settle(); if (composerNode === node) closeComposer(); countsAgain(); },
      onDiscard: async () => {
        await settle();
        const gone = draftId;
        if (composerNode === node) closeComposer();
        if (!gone) return;
        await request('DELETE', `/api/mail/unsent/${gone}`).catch(() => {});
        drafts = drafts.filter((d) => d.id !== gone);
        undoPlace.replaceChildren(undoBar('Draft discarded.', async () => { const back = await request('POST', `/api/mail/unsent/${gone}/restore`, {}); drafts = [...drafts, back]; await continueDraft(back); }));
        countsAgain();
      },
      onAllow: async (values) => {
        try {
          const google = mailAccounts.find((a) => a.id === accountOf(values))?.google_account_id;
          if (!google) { composerNode?.querySelector('.capture-problem')?.replaceChildren('This address is not signed in with Google: sign in under Settings › Google first.'); return; }
          sessionStorage.setItem(draftKey(id), JSON.stringify(values));
          const back = fresh ? `/mail?${new URLSearchParams({ split, ...(accountId ? { account: accountId } : {}), new: '1' })}` : `/mail?${new URLSearchParams({ split, ...(accountId ? { account: accountId } : {}), thread: id })}`;
          const asked = await request('PATCH', `/api/google/accounts/${google}`, { permission: 'mail.send', on: true, return_to: back });
          if (asked.url) location.assign(asked.url); else { composerNode?.remove(); composerNode = null; compose(fresh ? { fresh: true } : null); }
        } catch { /* the page says nothing more */ }
      },
      onSend: async (values, problem) => { await launch(await put(values, 'now').catch((err) => { problem.textContent = err.message; return null; }), values, true); },
      onLater: async (values, problem) => { await launch(await put(values, 'tomorrow').catch((err) => { problem.textContent = err.message; return null; }), values, false); },
    });
    async function launch(row, values, soon_) {
      if (!row) return;
      drafts = drafts.filter((d) => d.id !== draftId);
      if (composerNode === node) closeComposer();
      const bar = el('div', { class: 'undo-bar mail-sending', role: 'status' });
      const word = el('span', {});
      const undo = el('button', { type: 'button', class: 'button', onclick: async () => {
        clearInterval(tick);
        try {
          await request('POST', `/api/mail/sends/${row.id}/undo`, {});
          bar.remove();
          const back = { ...base, ...values, to: words(values.to), ...(fresh ? { cc: words(values.cc) } : {}) };
          // Taken back: it is a draft again, in Drafts, and in the composer.
          const again = (await request('POST', '/api/mail/unsent', { account_id: accountOf(values), ...(fresh ? {} : { thread_id: id }), to: values.to, cc: values.cc ?? '', subject: values.subject, body: values.body, remind_days: values.remind_days, confirm: values.confirm }).catch(() => ({}))).draft;
          if (again) { drafts = [...drafts, again]; back.draft_id = again.id; }
          if (fresh) composeNew({ ...back, fresh: true }); else compose(back);
          countsAgain();
        } catch (err) { word.textContent = err.message; }
      } }, 'Undo');
      bar.append(word, undo);
      undoPlace.replaceChildren(bar);
      const at = new Date(row.send_at);
      const left = () => Math.max(0, Math.ceil((at - Date.now()) / 1000));
      const draw = async () => {
        if (soon_ && left() > 0) { word.textContent = `Sending in ${left()} s`; return; }
        if (!soon_) { word.textContent = `Waits for tomorrow at ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`; return; }
        undo.remove();
        const mine = (await request('GET', '/api/mail/sends?limit=5').catch(() => [])).find((x) => x.id === row.id);
        word.textContent = mine?.state === 'sent' ? 'Sent.' : mine?.state === 'failed' ? `It did not go: ${mine.problem}` : mine?.problem ? mine.problem : 'Sending…';
        if (mine?.state === 'sent' || mine?.state === 'failed') clearInterval(tick);
      };
      const tick = setInterval(draw, 1000);
      draw();
      counts = { ...counts, outbox: (counts.outbox ?? 0) + 1 };
      soon = soon || Boolean(soon_);
      drawTabs();
      watchOutbox();
    }
    node.settle = settle;
    composing = false;
    composePlace.replaceChildren(composerNode);
    placeCompose();
    composerNode.replyingId = fresh ? '' : base.replying_to?.id ?? '';
    markReplying(composerNode.replyingId);
    if (fresh && !start.to.length) composerNode.focusTo(); else composerNode.focusBody();
    composerNode.scrollIntoView?.({ block: 'nearest' });
  }

  // Remind me (h): a small menu, later today, tomorrow, next week. It makes a task with a reminder, so the notice comes at the time.
  let remindMenu = null;
  function remind() {
    const current = shown[indexOfOpen()];
    if (!current || remindMenu) return;
    timed('remind', () => {
      const choices = remindChoices();
      remindMenu = el('div', { class: 'mail-remind', role: 'menu', 'aria-label': 'Remind me' },
        el('p', { class: 'capture-hint' }, `Remind me about “${current.subject || '(no subject)'}”`),
        ...choices.map((c, i) => el('button', { type: 'button', class: 'button', role: 'menuitem', 'data-choice': c.id, onclick: () => pick(c) }, keyHint(String(i + 1), `${c.name} · ${c.time}`))),
        el('button', { type: 'button', class: 'button button-quiet', onclick: closeRemind }, 'Not now'));
      remindMenu.choices = choices;
      remindPlace.replaceChildren(remindMenu);
      remindMenu.querySelector('button')?.focus();
    });
    async function pick(c) {
      closeRemind();
      try {
        await api.createTask({ text: `Reply: ${current.subject || 'a mail'}`, due: c.due, remind_time: c.time });
        undoPlace.replaceChildren(undoBar(`Reminder set: ${c.name}, ${c.time}.`, async () => {}));
      } catch { undoPlace.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, "The reminder wasn't made. Is the app still running?")); }
    }
  }
  function closeRemind() { remindMenu?.remove(); remindMenu = null; }

  // Invitation (y, Shift Y, n): the card at the top of the conversation answers with one key; the Calendar and the mail come after.
  const invitePlace = el('div', { class: 'mail-invite-place' });
  let invitePoll = null;
  const openInvite = () => { const t = openThreadData; if (!t || t.id !== openId) return null; const id = Object.keys(t.invites ?? {}).find((m) => !t.invites[m].cancelled && t.invites[m].method === 'REQUEST'); return id ? { messageId: id, card: t.invites[id] } : null; };
  function drawInvites(thread) {
    clearInterval(invitePoll);
    invitePlace.replaceChildren(...Object.entries(thread.invites ?? {}).map(([messageId, card]) => inviteCard(card, {
      onAnswer: (answer) => answerInvite(answer, messageId),
      onUndo: async () => { try { thread.invites[messageId] = await request('POST', `/api/mail/messages/${messageId}/invite/undo`, {}); drawInvites(thread); } catch (err) { undoPlace.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, err.message)); } },
    })));
    if (Object.values(thread.invites ?? {}).some((c) => c.answer?.send && ['waiting', 'sending'].includes(c.answer.send.state) && !c.answer.send.problem)) {
      let tries = 0;
      invitePoll = setInterval(async () => {
        if (++tries > 20 || openThreadData !== thread) { clearInterval(invitePoll); return; }
        try { thread.invites = (await request('GET', `/api/mail/threads/${thread.id}`)).invites; drawInvites(thread); } catch { clearInterval(invitePoll); }
      }, 2000);
    }
  }
  async function answerInvite(answer, messageId = null) {
    const found = messageId ? { messageId, card: openThreadData.invites[messageId] } : openInvite();
    if (!found || found.card.cancelled) return;
    const thread = openThreadData;
    const said = { yes: 'Yes', maybe: 'Maybe', no: 'No' }[answer];
    timed(answer, () => { // the card changes first
      thread.invites[found.messageId] = { ...found.card, answer: { said, word: { yes: 'Accepted', maybe: 'Tentative', no: 'Declined' }[answer], in_calendar: answer !== 'no', send: { state: 'waiting', problem: '' } } };
      drawInvites(thread);
    });
    try { thread.invites[found.messageId] = await request('POST', `/api/mail/messages/${found.messageId}/invite`, { answer }); } catch (err) {
      thread.invites[found.messageId] = found.card;
      undoPlace.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, err.message || "The answer didn't go through."));
    }
    if (openThreadData === thread) drawInvites(thread);
  }

  // Task (t, the Task button or Cmd K): the task pop-up opens with the subject (without Re:/Fwd:) as its title, who wrote
  // and when in its details, and the conversation linked; from Money it is due in two weeks. Nothing is made until Add task.
  // Reply (r, the Reply at the top): the newest mail in the conversation someone else wrote (else the newest), quoted.
  function replyLatest(all = false) {
    const t = openThreadData?.id === openId ? openThreadData : null;
    const me = new Set(accounts.map((a) => a.email.toLowerCase()));
    const m = t ? ([...t.messages].reverse().find((x) => !me.has(String(x.from.email).toLowerCase())) ?? t.messages.at(-1)) : null;
    if (!m) { compose(); return; }
    compose(null, { message: m.id, all });
  }
  function makeTask() {
    const current = shown[indexOfOpen()] ?? (openThreadData?.id === openId ? openThreadData : null);
    if (!current || !openId || document.querySelector('dialog.task-modal')) return;
    const id = openId;
    const thread = openThreadData?.id === id ? openThreadData : null;
    timed('task', () => {});
    const subject = String(thread?.subject ?? current.subject ?? '').replace(/^\s*((re|fwd?|aw|wg|sv)\s*:\s*)+/i, '').trim() || 'A mail';
    const last = thread?.messages?.at(-1);
    const from = last ? (last.from.name ? `${last.from.name} <${last.from.email}>` : last.from.email) : '';
    const details = last ? `From ${from}${last.sent_at ? `, ${shortDate(last.sent_at)} ${clockTime(last.sent_at)}` : ''}\n` : '';
    openTaskModal({
      defaults: { text: subject, details, due: (current.split ?? current.rule?.split ?? split) === 'money' ? addDays(todayDay(), 14) : '', mail: { thread_id: id, subject } },
      undoPlace,
      onChanged: async (made) => {
        undoPlace.replaceChildren(undoBar(`Task made: “${made.text}”${made.due ? `, due ${made.due}` : ''}.`, async () => { await request('DELETE', `/api/tasks/${made.id}`).catch(() => {}); if (openId === id) await open(id); }));
        if (openId === id) await open(id);
      },
    });
  }

  // Cmd K (Ctrl K) in Mail: every Mail command, each with its key beside it. Elsewhere Cmd K stays the app's quick capture.
  let dialog = null;
  function closeDialog() { dialog?.close(); dialog?.remove(); dialog = null; }
  function commands() {
    return [
      ...MAIL_KEYS.map((k) => ({ name: k.name, key: k.key, later: k.later, run: () => run(k.id) })),
      ...SPLITS.map(([id, name]) => ({ name: `Go to ${name}`, run: () => { split = id; openId = ''; refresh(); } })),
      { name: 'Import and sync', run: () => { location.assign('/mail/import'); } },
    ];
  }
  function run(id) {
    closeDialog();
    if (id === 'next') move(1); else if (id === 'previous') move(-1); else if (id === 'done') done(); else if (id === 'delete') trash(); else if (id === 'remind') remind(); else if (id === 'times') timesPanel(); else if (id === 'reply') replyLatest(); else if (id === 'new') composeNew(); else if (id === 'task') makeTask(); else if (id === 'yes' || id === 'maybe' || id === 'no') answerInvite(id); else if (id === 'addsender') { const c = openThreadData?.people?.find((x) => !x.person); if (c) addToPeople(c, openThreadData); }
  }
  function openPalette() {
    closeDialog();
    const input = el('input', { class: 'search-input', 'aria-label': 'Type a command', placeholder: 'Type a command', autocomplete: 'off' });
    const listEl = el('ul', { class: 'mail-palette-list', role: 'listbox', 'aria-label': 'Commands' });
    let active = 0;
    let found = commands();
    const draw = () => listEl.replaceChildren(...found.map((c, i) => el('li', {
      role: 'option', class: 'mail-command', 'aria-selected': String(i === active), 'aria-disabled': c.later ? 'true' : false, onclick: () => { if (!c.later) c.run(); },
    }, c.name, c.later ? el('span', { class: 'capture-hint' }, ' · later') : null, c.key ? keyHint(c.key) : null)));
    input.addEventListener('input', () => { const q = input.value.trim().toLowerCase(); found = commands().filter((c) => c.name.toLowerCase().includes(q)); active = 0; draw(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(found.length - 1, active + 1); draw(); } else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); draw(); } else if (event.key === 'Enter') { event.preventDefault(); const c = found[active]; if (c && !c.later) c.run(); }
    });
    draw();
    dialog = el('dialog', { class: 'capture-box mail-palette', 'aria-label': 'Mail commands' }, input, listEl);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) closeDialog(); });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  }

  // The question mark: each key with the time it took, and the bar it must stay under.
  function timesPanel() {
    closeDialog();
    const typical = (id) => { const t = times.get(id); return t?.length ? [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)] : null; };
    dialog = el('dialog', { class: 'capture-box mail-times', 'aria-label': 'Keys and their times' },
      el('h2', { class: 'settings-title' }, 'Keys and their times'),
      el('p', { class: 'capture-hint' }, `The screen changes first, the work after. Every key must stay under ${KEY_LIMIT_MS} ms.`),
      el('table', { class: 'mail-times-table' }, ...MAIL_KEYS.map((k) => {
        const ms = typical(k.id);
        return el('tr', { 'data-key': k.id }, el('td', {}, keyHint(k.key)), el('td', {}, k.name), el('td', { class: 'mail-time' }, k.later ? 'later' : ms === null ? 'not pressed yet' : `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`));
      })),
      el('button', { type: 'button', class: 'button button-quiet', onclick: closeDialog }, 'Close'));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
    document.body.append(dialog);
    dialog.showModal();
  }

  const onKey = (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    if (document.querySelector('dialog[open]')) return; // a pop-up is open: its keys are its own, never Done or Delete on the mail behind it
    if (remindMenu) {
      const n = Number(event.key);
      if (n >= 1 && n <= remindMenu.choices.length) { event.preventDefault(); remindMenu.querySelectorAll('[data-choice]')[n - 1].click(); } else if (event.key === 'Escape') { event.preventDefault(); closeRemind(); }
      return;
    }
    const key = event.key;
    if (key === 'j' || key === 'ArrowDown') { event.preventDefault(); move(1); } else if (key === 'k' || key === 'ArrowUp') { event.preventDefault(); move(-1); } else if (key === 'e') { event.preventDefault(); done(); } else if (key === '#' || key === 'd') { event.preventDefault(); trash(); } else if (key === 'h') { event.preventDefault(); remind(); } else if (key === 'r') { event.preventDefault(); replyLatest(); } else if (key === 'c') { event.preventDefault(); composeNew(); } else if (key === 't') { event.preventDefault(); makeTask(); } else if (key === 'y' || key === 'Y' || key === 'n') { event.preventDefault(); answerInvite(key === 'y' ? 'yes' : key === 'Y' ? 'maybe' : 'no'); } else if (key === 'P') { event.preventDefault(); const c = openThreadData?.id === openId ? openThreadData.people?.find((x) => !x.person) : null; if (c) addToPeople(c, openThreadData); } else if (key === '?') { event.preventDefault(); timesPanel(); }
  };
  const onPalette = (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopImmediatePropagation(); openPalette(); }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onPalette, true); // before the app's own Cmd K (quick capture), which stays the app's everywhere else
  onLeave(() => { document.removeEventListener('keydown', onKey); window.removeEventListener('keydown', onPalette, true); closeDialog(); });

  // A mail's body: its own html in the sealed frame (images held back until you ask, per sender), else its text.
  function mailBody(m) {
    if (!m.html) return [el('div', { class: 'mail-text' }, m.text || '(no text)')];
    const images = remoteImages(m.html);
    const place = el('div', { class: 'mail-body' });
    const sender = m.from.email;
    const draw = (load) => {
      place.replaceChildren(
        sealedFrame(m.html, { images: load }),
        ...(images.count ? [el('p', { class: 'mail-images-bar', role: 'status' }, icon('link'), load
          ? ` Images from ${sender} load, and that is remembered for this sender. `
          : ` ${images.count === 1 ? 'An image was' : `${images.count} images were`} held back: nothing was fetched from ${images.hosts.join(', ') || 'the sender'}. `,
        el('button', { type: 'button', class: 'button button-quiet', onclick: async () => {
          try { await request('PUT', '/api/mail/senders', { email: sender, load_images: !load }); } catch { return; }
          m.images_ok = !load;
          draw(!load);
        } }, load ? 'Stop loading images' : 'Load images from this sender'))] : []),
        ...(suspiciousLinks(m.html).length ? [el('ul', { class: 'mail-link-marks', 'aria-label': 'Links that go somewhere else' },
          ...suspiciousLinks(m.html).map((l) => el('li', {}, icon('link'), ` “${l.text}” says ${l.shown} but goes to ${l.goesTo}.`)))] : []));
    };
    draw(Boolean(m.images_ok));
    return [place];
  }

  // Reply and Reply all on each mail: the answer is to that mail, and says so. Reply all only when more than one other person is on it.
  function replyButtons(m) {
    const me = new Set(accounts.map((a) => a.email.toLowerCase()));
    const others = new Set([m.from, ...m.to, ...m.cc].map((a) => String(a?.email ?? '').toLowerCase()).filter((e) => e && !me.has(e)));
    const who = m.from.name || m.from.email;
    return el('span', { class: 'mail-message-actions' },
      el('button', { type: 'button', class: 'button button-quiet mail-reply', 'aria-label': `Reply to ${who}`, title: `Reply to this mail from ${who}`, onclick: () => compose(null, { message: m.id }) }, icon('back'), ' Reply'),
      ...(others.size > 1 ? [el('button', { type: 'button', class: 'button button-quiet mail-reply-all', 'aria-label': `Reply all, to this mail from ${who}`, title: 'Reply to everyone on this mail', onclick: () => compose(null, { message: m.id, all: true }) }, 'Reply all')] : []));
  }

  // The order of a conversation (2026-11-12, the owner's wish): newest first by default, the newest mail at the top and older ones
  // further down; one press turns it back to oldest first. Kept in this browser. Newest first, the composer sits above the mails.
  const ORDER_KEY = 'mail.order';
  let newestFirst = true;
  try { newestFirst = localStorage.getItem(ORDER_KEY) !== 'oldest'; } catch { /* newest first */ }
  function placeCompose() {
    const anchor = reader.querySelector('.mail-compose-anchor');
    if (newestFirst && anchor) anchor.replaceWith(composePlace);
    else if (newestFirst && reader.contains(composePlace)) { /* in place, above the mails */ } else if (composePlace.parentNode !== readerCol || composePlace.previousSibling !== reader) reader.after(composePlace);
  }
  function orderButton() {
    return el('button', { type: 'button', class: `button button-quiet mail-order${newestFirst ? '' : ' is-oldest'}`, title: 'Change the order of the mails in a conversation', 'aria-label': newestFirst ? 'Newest first: show oldest first' : 'Oldest first: show newest first',
      onclick: async () => {
        newestFirst = !newestFirst;
        try { localStorage.setItem(ORDER_KEY, newestFirst ? 'newest' : 'oldest'); } catch { /* this time only */ }
        if (openId) await open(openId);
      } }, icon('down'), newestFirst ? ' Newest first' : ' Oldest first');
  }

  // One conversation, as plain text (a mail's own html is never shown here), with the rule that put it in its split.
  async function open(id) {
    let thread;
    try { thread = await request('GET', `/api/mail/threads/${id}`); } catch { reader.replaceChildren(el('p', { class: 'empty' }, 'That conversation is not here any more.')); return; }
    layout.classList.add('is-open');
    openThreadData = thread;
    reader.replaceChildren(
      el('a', { class: 'back-link mail-back', href: `/mail?split=${split}`, onclick: (event) => { event.preventDefault(); openId = ''; refresh(); } }, icon('back'), 'Mail'),
      el('p', { class: 'mail-rule', role: 'status' }, icon('task'), ` ${thread.rule.why}`),
      el('div', { class: 'mail-reader-head' },
        el('h2', { class: 'mail-reader-subject' }, thread.subject || '(no subject)'),
        orderButton(),
        el('button', { type: 'button', class: 'button button-quiet mail-reply-top', title: 'Reply to the newest mail (r)', onclick: () => replyLatest() }, icon('back'), ' Reply'),
        el('button', { type: 'button', class: 'button button-quiet mail-task', title: 'Make a task of it (t)', onclick: () => makeTask() }, icon('task'), ' Task'),
        el('button', { type: 'button', class: 'button button-quiet mail-delete', 'aria-label': 'Delete', title: 'Delete (# or d): to Gmail’s Trash', onclick: () => trash() }, icon('trash'))),
      invitePlace,
      ...drafts.filter((d) => d.thread_id === thread.id).slice(0, 1).map((d) => el('p', { class: 'mail-draft-line', role: 'status' },
        el('span', { class: 'outbox-draft-mark' }, icon('edit'), ' Draft'), ` ${firstWords(d.body) || 'No words yet'} `,
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => continueDraft(d) }, keyHint('r', 'Continue writing')))),
      ...(thread.tasks?.length ? [el('ul', { class: 'mail-tasks', 'aria-label': 'Tasks from this conversation' }, ...thread.tasks.map((t) => el('li', { class: t.done ? 'is-done' : '' }, icon('task'), ` Task: `, el('a', { href: '/tasks' }, t.text), t.due ? ` · due ${t.due}` : '', t.done ? ' · done' : '')))] : []),
      ...(thread.people?.length ? [peopleCards(thread.people, { onAdd: (c) => addToPeople(c, thread) })] : []),
      ...(thread.confirmations?.length ? [el('div', { class: 'confirm-rows', role: 'list', 'aria-label': 'Read confirmations' }, ...thread.confirmations.map(openedChip))] : []),
      ...(newestFirst ? [el('div', { class: 'mail-compose-anchor' })] : []),
      ...(newestFirst ? [...thread.messages].reverse() : thread.messages).map((m) => el('article', { class: 'mail-message', 'data-message': m.id },
        el('header', { class: 'mail-message-head' },
          el('strong', {}, m.from.name || m.from.email), el('span', { class: 'mail-message-when' }, m.sent_at ? `${shortDate(m.sent_at)} ${clockTime(m.sent_at)}` : ''),
          replyButtons(m),
          el('span', { class: 'mail-message-to' }, `To ${m.to.map(address).join(', ') || '—'}${m.cc.length ? ` · Cc ${m.cc.map(address).join(', ')}` : ''}`)),
        ...mailBody(m),
        ...(m.attachments.length ? [el('p', { class: 'mail-attachments' }, icon('link'), ' ', ...m.attachments.flatMap((name, i) => {
          const file = m.attachment_files.find((f) => f.name === name);
          return [i ? ', ' : '', file ? el('a', { href: `/files/${file.sha256}`, download: file.name }, name) : name];
        }))] : []))));
    drawInvites(thread);
    placeCompose();
    if (composerNode) markReplying(composerNode.replyingId ?? '');
  }

  try { accounts = (await request('GET', '/api/mail')).accounts; } catch { accounts = []; }
  await refresh();
  if (params.get('draft')) {
    // Edit on a draft card from your assistant: its conversation opens and the draft is in the composer, to change and send.
    try {
      const draft = await request('GET', `/api/mail/drafts/${params.get('draft')}`);
      openId = draft.thread_id;
      keep();
      await open(openId);
      compose({ ...draft, remind_days: 0, confirm: false });
    } catch (err) { undoPlace.replaceChildren(el('p', { class: 'capture-problem', role: 'alert' }, err.message || 'That draft is not waiting any more.')); }
  } else if (params.get('new')) {
    // New email, also on the way back from Google's question: the words are there again.
    keep();
    composeNew();
  } else if (openId && sessionStorage.getItem(draftKey(openId))) setTimeout(() => compose(), 300); // back from Google: the words are there again
}
