// Mail (/mail, advanced/mail/2): every message you ever got, kept in this app's own database. Your whole
// history comes in once from a Google Takeout .mbox, read on this computer one message at a time (the page
// hands the file to this app's server, which never sends it anywhere), with the count as it goes, label by
// label. Safe to run twice: a message that is here already is not added again. Below it: the labels with
// their counts, the files read in, and the conversations that are rows now.

import { el, icon, request, shortDate, clockTime, timeAgo } from './ui.js';
import { app, screen, onLeave } from './shell.js';
import { moduleOn } from './modules.js';

const number = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${number(n)} ${n === 1 ? one : many}`;
const megabytes = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const KIND_WORDS = { system: 'Gmail', category: 'Gmail category', user: 'Yours' };

// The Mail row: one conversation, one line. Who wrote, the subject, the last words, how many messages and when.
// (Lesson 5's list is made of these.)
export function mailRow(thread, { onOpen = null, current = false } = {}) {
  const people = thread.participants.length ? thread.participants.join(', ') : '(nobody)';
  const body = [
    el('span', { class: 'mail-shape' }, icon('mail')),
    el('span', { class: 'mail-main' },
      el('span', { class: 'mail-who' }, people),
      el('span', { class: 'mail-subject' }, thread.subject || '(no subject)'),
      el('span', { class: 'mail-snippet' }, thread.snippet)),
    el('span', { class: 'mail-meta' },
      thread.account_letter ? el('span', { class: 'mail-letter', title: thread.account_email, 'aria-label': `Account ${thread.account_email}` }, thread.account_letter) : null,
      el('span', { class: 'mail-count' }, plural(thread.message_count, 'message', 'messages')),
      thread.last_at ? el('time', { datetime: thread.last_at }, shortDate(thread.last_at)) : null),
  ];
  return onOpen
    ? el('button', { type: 'button', class: 'mail-row mail-row-open', role: 'listitem', 'data-thread': thread.id, 'data-unread': String(Boolean(thread.unread)), 'aria-current': current ? 'true' : false, onclick: () => onOpen(thread) }, ...body)
    : el('div', { class: 'mail-row', role: 'listitem', 'data-thread': thread.id, 'data-unread': String(Boolean(thread.unread)) }, ...body);
}

// The Opened chip (Mail 9): what a read confirmation can know, and only that. "Opened · today 10:21" when something counted opened the mail,
// grey "Not opened yet" when nothing is known, and what did not count listed with its reason. Never the word Read.
export function openedChip(c) {
  const day = (iso) => { const d = new Date(iso); return `${d.toDateString() === new Date().toDateString() ? 'today' : shortDate(iso)} ${clockTime(iso)}`; };
  return el('div', { class: 'confirm-row', role: 'listitem', 'data-opened': String(Boolean(c.opened_at)) },
    el('span', { class: 'confirm-mail' }, `To ${c.to.join(', ')} · ${c.subject || '(no subject)'}`),
    el('span', { class: 'confirm-chip' }, icon('mail'), c.opened_at ? ` Opened · ${day(c.opened_at)}${c.opens > 1 ? ` · ${c.opens} times` : ''}` : ' Not opened yet'),
    ...c.not_counted.map((n) => el('span', { class: 'confirm-skipped' }, `Not counted: ${n.why} at ${clockTime(n.at)}`)));
}

// The Count check row: a label, Gmail's own count next to this app's, and the word Equal, or how many are still to fill.
// The word and the shape carry it (a tick, or a number to fill), never colour alone.
export function countRow(row) {
  return el('div', { class: 'count-row', role: 'listitem', 'data-label': row.label, 'data-equal': String(row.equal) },
    el('span', { class: 'count-label' }, row.label),
    el('span', { class: 'count-number', 'aria-label': `Gmail ${row.gmail}` }, number(row.gmail)),
    el('span', { class: 'count-number', 'aria-label': `Yours ${row.ours}` }, number(row.ours)),
    el('span', { class: 'count-state' }, row.equal ? [icon('task'), ' Equal'] : row.only_here ? 'Only here' : `${number(row.to_fill)} to fill`));
}

// The sync line: when Gmail and this app last agreed, in one line, and what waits to go.
export function syncLineText(sync, { now = Date.now() } = {}) {
  if (!sync) return '';
  const ago = sync.synced_at ? timeAgo(sync.synced_at) : '';
  const waiting = sync.waiting ? ` · ${plural(sync.waiting, 'change', 'changes')} waiting` : '';
  if (sync.sync_error) return `Live paused: ${sync.sync_error}${waiting}`;
  if (!sync.live) return `Live is off${sync.synced_at ? ` · last synced ${ago}` : ''}${waiting}`;
  return `Live · ${sync.synced_at ? `synced ${ago}` : 'starting'}${waiting}`;
}

const OUTBOX_WORDS = { waiting: 'Waiting', sent: 'Sent to Gmail', skipped: 'Not sent', failed: 'Failed' };
// actions: quiet buttons under the row (Mail's Outbox: Try again, Let it go).
export const outboxRow = (o, actions = []) => el('div', { class: 'outbox-row', role: 'listitem', 'data-state': o.state },
  el('span', { class: 'outbox-what' }, [...o.add.map((l) => `+ ${l}`), ...o.remove.map((l) => `− ${l}`)].join('  ') || 'Nothing to send'),
  el('span', { class: 'outbox-subject' }, o.subject || '(no subject)'),
  el('span', { class: 'outbox-state' }, `${OUTBOX_WORDS[o.state]}${o.problem ? ` · ${o.problem}` : ''}`),
  ...(actions.length ? [el('span', { class: 'outbox-actions' }, ...actions)] : []));

// Where a mail you wrote is, in words: in its ten seconds, waiting for Send later, being sent, or failed (with why).
export function sendWords(s, now = Date.now()) {
  const at = new Date(s.send_at);
  if (s.state === 'failed') return `Did not go · ${s.problem || 'Gmail did not take it.'}`;
  if (s.state === 'sending') return 'Sending…';
  if (s.problem) return s.problem;
  const left = Math.ceil((at - now) / 1000);
  if (left <= 0) return 'Sending…';
  if (left <= 60) return `Sending in ${left} s`;
  const day = at.toDateString() === new Date(now).toDateString() ? 'today' : shortDate(s.send_at);
  return `Waits until ${day} ${clockTime(s.send_at)}`;
}
// The Outbox row for a mail: who it is to (bold), the subject, where it is in words, and its buttons (the Outbox row's look, stacked).
export const outboxMailRow = (s, actions = []) => el('div', { class: 'outbox-row is-mail', role: 'listitem', 'data-state': s.state, 'data-send': s.id },
  el('span', { class: 'outbox-what' }, `To ${s.to.join(', ') || '—'}`),
  el('span', { class: 'outbox-subject' }, s.subject || '(no subject)'),
  el('span', { class: 'outbox-state' }, sendWords(s)),
  ...(actions.length ? [el('span', { class: 'outbox-actions' }, ...actions)] : []));

export async function showMailImport() {
  document.title = 'Mail · Import and sync';
  app.className = 'page mail-page';
  if (!moduleOn('mail')) {
    screen.replaceChildren(
      el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Mail')),
      el('p', { class: 'empty' }, 'Mail is switched off. Everything it kept is still here. ', el('a', { href: '/settings' }, 'Switch it on in Settings.')));
    return;
  }

  let file = null;
  let polling = null;
  let busy = false;
  const account = el('input', { type: 'text', class: 'detail-input', 'aria-label': 'Mail address', placeholder: 'The address this mail is from, e.g. you@example.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const chosen = el('span', { class: 'mail-chosen' }, 'No file chosen yet.');
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const report = el('p', { class: 'import-report', role: 'status' });
  const progress = el('ul', { class: 'mail-progress', 'aria-label': 'Messages read so far, by label' });
  const run = el('button', { type: 'button', class: 'button button-primary', disabled: true, onclick: () => go() }, 'Import');
  const input = el('input', {
    type: 'file', class: 'import-file', accept: '.mbox,.mbx,application/mbox,text/plain', 'aria-label': 'Choose a Takeout .mbox file',
    // The list is emptied once the file is taken, so choosing the same path again (a newer export over the old one) is a change too.
    onchange: () => { const next = input.files?.[0]; input.value = ''; choose(next); },
  });
  const drop = el('label', { class: 'mail-drop' }, icon('mail'), el('span', {}, 'Drop the .mbox file here, or ', el('u', {}, 'choose it')), chosen, input);
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    choose(event.dataTransfer?.files?.[0]);
  });

  function choose(next) {
    if (busy || !next) return;
    file = next;
    chosen.textContent = `${file.name} · ${megabytes(file.size)}`;
    report.textContent = '';
    problem.textContent = '';
    progress.replaceChildren();
    run.disabled = false;
  }

  // Fill from Gmail and the count check (Mail 3), read only.
  let mailAccount = null; // this app's mail account for the address in the form
  let lastCheck = null;
  const fillReport = el('p', { class: 'import-report', role: 'status' });
  const fillProblem = el('p', { class: 'capture-problem', role: 'alert' });
  const fillNote = el('p', { class: 'empty' });
  const fillButton = el('button', { type: 'button', class: 'button', onclick: () => fill(false) }, 'Fill from Gmail');
  const checkButton = el('button', { type: 'button', class: 'button', onclick: () => check() }, 'Check the counts');
  const missingButton = el('button', { type: 'button', class: 'button', hidden: true, onclick: () => fill(true) }, 'Fill what is missing');
  const countRows = el('div', { class: 'count-rows', role: 'list', 'aria-label': 'Counted on both sides' });
  const countHead = el('div', { class: 'count-row count-head', 'aria-hidden': 'true' }, el('span', {}, 'Label'), el('span', {}, 'Gmail'), el('span', {}, 'Yours'), el('span', {}, ''));
  const attachLine = el('p', { class: 'empty' });

  function showFillState() {
    const ready = Boolean(mailAccount?.can_read);
    fillButton.disabled = !ready;
    checkButton.disabled = !ready;
    fillNote.replaceChildren(...(ready ? ['Everything newer than your export comes in from Gmail, read only. Each message is matched by Gmail’s own id, so running it again adds nothing.']
      : [mailAccount?.signed_in ? 'Switch on “Read your mail” for this address under ' : 'Sign in with Google and switch on “Read your mail” under ', el('a', { href: '/settings' }, 'Settings › Google'), ' to fill from Gmail.']));
  }

  async function fill(everything) {
    if (!mailAccount || busy) return;
    busy = true;
    fillProblem.textContent = '';
    fillReport.textContent = 'Asking Gmail…';
    for (const b of [fillButton, checkButton, missingButton]) b.disabled = true;
    polling = setInterval(async () => { try { const st = await request('GET', '/api/mail/import/status'); if (st.running) { drawProgress(st); fillReport.textContent = `Filling… ${plural(st.read, 'message', 'messages')} read, ${number(st.added)} new`; } } catch { /* the next one */ } }, 400);
    try {
      const body = await request('POST', '/api/mail/fill', { account_id: mailAccount.id, ...(everything ? { everything: true } : {}) });
      fillReport.textContent = body.added ? `Filled: ${plural(body.added, 'message', 'messages')} from Gmail.` : 'Nothing newer: you are up to date.';
      lastCheck = null;
      countRows.replaceChildren();
      missingButton.hidden = true;
    } catch (err) { fillProblem.textContent = err.message; fillReport.textContent = ''; } finally {
      clearInterval(polling);
      busy = false;
      progress.replaceChildren();
      await loadOverview();
      loadThreads();
    }
  }

  async function check() {
    if (!mailAccount || busy) return;
    fillProblem.textContent = '';
    fillReport.textContent = 'Counting on both sides…';
    try {
      lastCheck = await request('POST', '/api/mail/count-check', { account_id: mailAccount.id });
      countRows.replaceChildren(countHead, ...lastCheck.rows.map(countRow),
        countRow({ label: 'All mail', gmail: lastCheck.total.gmail, ours: lastCheck.total.ours, equal: lastCheck.total.equal, to_fill: Math.max(0, lastCheck.total.gmail - lastCheck.total.ours) }));
      fillReport.textContent = lastCheck.equal && lastCheck.total.equal ? 'Every label is equal: your archive is whole.' : 'Some labels differ.';
      missingButton.hidden = lastCheck.equal && lastCheck.total.equal;
    } catch (err) { fillProblem.textContent = err.message; fillReport.textContent = ''; }
  }

  // Live with Gmail (Mail 4): Gmail's changes in, yours out. A switch (off until you turn it on), a round by hand, what is on its way.
  const syncLine = el('p', { class: 'sync-line', role: 'status' });
  const liveProblem = el('p', { class: 'capture-problem', role: 'alert' });
  const liveSwitch = el('div', { class: 'switch', role: 'group', 'aria-label': 'Live with Gmail' });
  const outbox = el('div', { class: 'outbox-rows', role: 'list', 'aria-label': 'On its way to Gmail' });
  const syncButton = el('button', { type: 'button', class: 'button', onclick: () => syncNow() }, 'Sync now');
  const liveNote = el('p', { class: 'empty' }, 'Gmail’s changes come in every twenty seconds while this app is open, and what you change here (archive, star, a label) goes back to Gmail through an outbox, once “Change your mail in Gmail” is on under Settings › Google. Off until you switch it on.');

  function drawLive() {
    const sync = mailAccount?.sync;
    const ready = Boolean(mailAccount?.can_read);
    syncLine.textContent = syncLineText(sync);
    syncButton.disabled = !ready;
    liveSwitch.replaceChildren(...[[true, 'On'], [false, 'Off']].map(([on, label]) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(Boolean(sync?.live) === on), disabled: !ready,
      onclick: async () => {
        liveProblem.textContent = '';
        try { await request('POST', '/api/mail/live', { account_id: mailAccount.id, on }); await loadOverview(); } catch (err) { liveProblem.textContent = err.message; }
      },
    }, label)));
  }
  async function loadOutbox() {
    let rows = [];
    try { rows = await request('GET', '/api/mail/outbox?limit=10'); } catch { return; }
    outbox.replaceChildren(...(rows.length ? rows.map(outboxRow) : [el('p', { class: 'empty' }, 'Nothing on its way.')]));
  }
  async function syncNow() {
    if (!mailAccount || busy) return;
    liveProblem.textContent = '';
    try { await request('POST', '/api/mail/sync', { account_id: mailAccount.id }); } catch (err) { liveProblem.textContent = err.message; }
    await loadOverview();
    loadOutbox();
    loadThreads();
  }
  const refresh = setInterval(() => { if (!busy) { loadOverview(); loadOutbox(); } }, 15_000);
  onLeave(() => clearInterval(refresh));

  const pixelBaseField = el('input', { class: 'detail-input', 'aria-label': 'Public address of this app', placeholder: 'https://your-address.example', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const pixelProblem = el('p', { class: 'capture-problem', role: 'alert' });
  const pixelExample = el('code', {}, 'https://your-address.example/o/<token>.gif');
  const drawExample = () => { pixelExample.textContent = `${pixelBaseField.value || 'https://your-address.example'}/o/<token>.gif`; };
  async function savePixelBase() {
    pixelProblem.textContent = '';
    const typed = pixelBaseField.value.trim().replace(/\/+$/, '');
    if (typed && !/^(https:\/\/[A-Za-z0-9.-]+(:\d+)?|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(typed)) { pixelProblem.textContent = 'Give the address as https://your-name.example (no path), the way the other side can reach this app.'; return; }
    try { const saved = await request('PUT', '/api/mail/pixel-base', { base: pixelBaseField.value }); pixelBaseField.value = saved.base; drawExample(); } catch (err) { pixelProblem.textContent = err.message; }
  }
  request('GET', '/api/mail/confirmations').then((c) => { pixelBaseField.value = c.base; drawExample(); }).catch(() => {});
  const labelRows = el('div', { class: 'mail-label-rows' });
  const summary = el('p', { class: 'empty', role: 'status' });
  const imports = el('div', { class: 'mail-imports' });
  const threads = el('div', { class: 'mail-threads', role: 'list', 'aria-label': 'In your database' });
  const search = el('input', {
    type: 'search', class: 'search-input', placeholder: 'Search your mail', 'aria-label': 'Search your mail', autocomplete: 'off',
    oninput: () => { clearTimeout(timer); timer = setTimeout(loadThreads, 150); },
  });
  let timer = null;
  let run1 = 0;

  async function loadThreads() {
    const mine = ++run1;
    let rows = [];
    try { rows = await request('GET', `/api/mail/threads?${new URLSearchParams({ q: search.value.trim(), limit: '30' })}`); } catch {
      threads.replaceChildren(el('p', { class: 'empty' }, "Your mail couldn't be loaded. Is the app still running?"));
      return;
    }
    if (mine !== run1) return;
    threads.replaceChildren(...(rows.length ? rows.map(mailRow)
      : [el('p', { class: 'empty' }, search.value.trim() ? 'No conversation has those words.' : 'No mail yet. Import your Takeout file above.')]));
  }

  async function loadOverview() {
    let o;
    try { o = await request('GET', '/api/mail'); } catch { summary.textContent = "Mail couldn't be loaded. Is the app still running?"; return; }
    mailAccount = o.accounts.find((a) => a.email === account.value.trim().toLowerCase()) ?? o.accounts[0] ?? null;
    showFillState();
    drawLive();
    attachLine.textContent = o.attachments.links ? `${plural(o.attachments.links, 'attachment', 'attachments')} kept in your files, ${plural(o.attachments.files, 'different file', 'different files')}, each stored once.` : '';
    summary.textContent = o.messages
      ? `${plural(o.messages, 'message', 'messages')} in ${plural(o.threads, 'conversation', 'conversations')}, over ${plural(o.labels.length, 'label', 'labels')}.`
      : 'Nothing is kept yet.';
    labelRows.replaceChildren(...o.labels.map((l) => el('div', { class: 'mail-label-row', 'data-label': l.name },
      el('span', { class: 'mail-label-name' }, l.name), el('span', { class: 'mail-label-kind' }, KIND_WORDS[l.kind]), el('span', { class: 'mail-label-count' }, number(l.count)))));
    imports.replaceChildren(...(o.imports.length ? o.imports.map((i) => el('div', { class: 'mail-import-row', 'data-status': i.status },
      el('span', { class: 'mail-import-name' }, i.filename || '(a file)'),
      el('span', { class: 'mail-import-what' }, i.status === 'done' ? `Imported · ${plural(i.read, 'message', 'messages')}, ${number(i.added)} new, ${number(i.already_here)} here already`
        : i.status === 'running' ? 'Being read…' : i.status === 'interrupted' ? `Stopped · ${number(i.added)} new so far; read it again to go on` : `Failed · ${i.problem || 'it could not be read'}`),
      el('span', { class: 'mail-import-when' }, `${i.account} · ${timeAgo(i.finished_at ?? i.created_at)}`)))
      : [el('p', { class: 'empty' }, 'No file read in yet.')]));
  }

  // The count so far, label by label, asked of the server while the file goes in.
  function drawProgress(s) {
    const percent = s.size ? Math.min(99, Math.floor((s.bytes / s.size) * 100)) : null;
    report.textContent = `Reading… ${plural(s.read, 'message', 'messages')} read, ${number(s.added)} new${percent === null ? '' : ` · ${percent}%`}`;
    progress.replaceChildren(...Object.entries(s.labels ?? {}).sort((a, b) => b[1] - a[1]).map(([name, count]) =>
      el('li', { class: 'mail-progress-row' }, el('span', {}, name), el('span', {}, number(count)))));
  }

  async function go() {
    if (!file || busy) return;
    // Asked before the file is sent: a refusal should not cost a whole mailbox's upload.
    if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(account.value.trim())) { problem.textContent = 'Which address is this mail from? Give it as name@example.com.'; return; }
    busy = true;
    run.disabled = true;
    problem.textContent = '';
    report.textContent = 'Reading…';
    polling = setInterval(async () => { try { const s = await request('GET', '/api/mail/import/status'); if (s.running) drawProgress(s); } catch { /* the next one */ } }, 400);
    try {
      const res = await fetch(`/api/mail/import?${new URLSearchParams({ account: account.value.trim() })}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `The file could not be read (${res.status}).`);
      clearInterval(polling);
      drawProgress({ read: body.read, added: body.added, size: 0, bytes: 0, labels: body.labels });
      report.textContent = `Imported: ${plural(body.read, 'message', 'messages')} read, ${number(body.added)} new, ${number(body.already_here)} here already${body.skipped ? `, ${number(body.skipped)} could not be read` : ''}.`;
    } catch (err) {
      problem.textContent = err.message;
      report.textContent = '';
    } finally {
      clearInterval(polling);
      busy = false;
      run.disabled = !file;
      loadOverview();
      loadThreads();
    }
  }

  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('a', { class: 'back-link', href: '/mail' }, icon('back'), ' Mail'), el('h1', { class: 'top-bar-title' }, 'Import and sync'), el('label', { class: 'search' }, icon('search'), search)),
    el('section', { class: 'settings-part', 'aria-label': 'Import' },
      el('h2', { class: 'settings-title' }, 'Import your history'),
      el('p', { class: 'empty' }, 'Export your mail with Google Takeout (choose only Mail), unzip it, and give the .mbox file here. It is read on this computer, one message at a time, and goes nowhere else. Reading the same file again, or a newer export, adds only what is new.'),
      el('div', { class: 'mail-import-form' }, account, drop, run), problem, report, progress),
    el('section', { class: 'settings-part', 'aria-label': 'Fill from Gmail' },
      el('h2', { class: 'settings-title' }, 'Fill from Gmail'), fillNote,
      el('div', { class: 'google-actions' }, fillButton, checkButton, missingButton), fillProblem, fillReport,
      el('h3', { class: 'settings-title' }, 'Counted on both sides'), countRows),
    el('section', { class: 'settings-part', 'aria-label': 'Live with Gmail' },
      el('h2', { class: 'settings-title' }, 'Live with Gmail'), liveNote,
      el('div', { class: 'permission-row' }, el('span', { class: 'permission-name' }, 'Keep Gmail and this app in step'), liveSwitch),
      el('div', { class: 'google-actions' }, syncButton), liveProblem,
      el('h3', { class: 'settings-title' }, 'On its way to Gmail'), outbox),
    el('section', { class: 'settings-part', 'aria-label': 'Read confirmations' },
      el('h2', { class: 'settings-title' }, 'Read confirmations'),
      el('p', { class: 'empty' }, 'A read confirmation is a one-pixel picture in a mail you send. It can only tell you that something opened the mail: this app says “Opened”, never “Read”, and lists a mail scanner or a privacy proxy without counting it. It is off by default, switched on per mail in the composer, and remembered per person. Where it is the law, the other person has to agree to it first.'),
      el('p', {}, 'The one address anything outside may reach: ', pixelExample, el('span', { class: 'capture-hint' }, ' · it looks the token up, writes a row and returns the picture, nothing else.')),
      el('div', { class: 'dictation-key' }, pixelBaseField, el('button', { type: 'button', class: 'button', onclick: savePixelBase }, 'Save the address')), pixelProblem,
      el('p', { class: 'capture-hint' }, 'This app answers only this computer, so the other side cannot reach a picture until you give it an address it can (and add its name to HOSTS). Without one the switch in the composer stays off.')),
    el('section', { class: 'settings-part', 'aria-label': 'Your mail' },
      el('h2', { class: 'settings-title' }, 'Your mail'), summary, attachLine, labelRows),
    el('section', { class: 'settings-part', 'aria-label': 'Files read in' },
      el('h2', { class: 'settings-title' }, 'Files read in'), imports),
    el('section', { class: 'settings-part', 'aria-label': 'In your database' },
      el('h2', { class: 'settings-title' }, 'In your database'), threads),
    syncLine);

  // The address to read the file as: one already used, else a signed-in Google account.
  request('GET', '/api/mail').then(async (o) => {
    let email = o.accounts[0]?.email ?? '';
    if (!email) email = (await request('GET', '/api/google').catch(() => ({ accounts: [] }))).accounts[0]?.email ?? '';
    if (!account.value) account.value = email;
  }).catch(() => {});
  loadOverview();
  loadThreads();
  loadOutbox();
}
