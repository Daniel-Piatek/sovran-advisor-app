// The Library (/library, foundations/8): the design library on a page you can open. Every
// token of public/tokens.css with its live value (it follows Light/Dark), then the pieces the
// screens are built from, drawn with the app's own classes. A new colour or piece goes into
// tokens.css and style.css first, and into this page too.
// The accent is shown once, as the primary Button: the page's one accent.

import { el, icon } from './ui.js';
import { app, screen } from './shell.js';
import { mentionChip } from './mentions.js';
import { timelineRow, nowLine } from './timeline.js';
import { logLine } from './log-line.js';
import { cadenceChip } from './cadence.js';
import { mergePair } from './merge.js';
import { glossaryRow } from './settings.js';
import { googleAccountRow } from './google.js';
import { mailRow, countRow, outboxRow, outboxMailRow, openedChip } from './mail.js';
import { commentThread } from './comments.js';
import { versionList, diffView } from './versions.js';
import { clashBox } from './clash.js';
import { boardCard } from './board.js';
import { importReport } from './import-notes.js';
import { strokePath } from './ink.js';
import { splitTabs, keyHint, sealedFrame, composer, inviteCard } from './mail-app.js';
import { kindMark, repeatChip } from './quick-add.js';
import { calendarLinkRow, sentencePreview, gMark, answerBar } from './calendar.js';
import { readEvent } from './event-words.js';
import { hourGrid, taskBlock, lensControls, templateChip } from './day-hours.js';
import { dayOrder } from './day-order.js';
import { notice } from './reminders.js';
import { worldTag } from './inbox.js';

const root = document.documentElement;
const value = (token) => getComputedStyle(root).getPropertyValue(token).trim();

// Each live value is a text that is read again when the theme changes.
const live = [];
function valueOf(token) {
  const node = el('code', { class: 'lib-value' }, value(token));
  live.push([node, token]);
  return node;
}

const swatch = (token, label, { text = false } = {}) => el('div', { class: 'lib-swatch' },
  el('div', { class: 'lib-chip', style: text ? `color: var(${token})` : `background: var(${token})` }, text ? 'Aa' : ''),
  el('span', { class: 'lib-name' }, label ?? token), valueOf(token));

const part = (title, note, ...content) => el('section', { class: 'settings-part', 'aria-label': title },
  el('h2', { class: 'settings-title' }, title), note ? el('p', { class: 'empty' }, note) : null, ...content);

const demo = (name, ...content) => el('div', { class: 'lib-demo' }, el('div', { class: 'lib-sample' }, ...content), el('span', { class: 'lib-name' }, name));

function checkbox(checked) {
  const box = el('span', { class: 'task-box', role: 'checkbox', 'aria-checked': String(checked), 'aria-label': checked ? 'Ticked' : 'Not ticked' });
  box.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  if (checked) box.style.color = 'var(--color-text)';
  return box;
}

const sizes = [
  ['Page title', '--text-2xl', 'var(--font-heading)'], ['Heading', '--text-xl', 'var(--font-heading)'],
  ['Sub-heading', '--text-lg', 'var(--font-ui)'], ['Text', '--text-base', 'var(--font-body)'],
  ['Small', '--text-sm', 'var(--font-ui)'], ['Label', '--text-xs', 'var(--font-ui)'],
];

export function showLibrary() {
  document.title = 'Library';
  app.className = 'page';
  live.length = 0;

  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Library')),
    el('p', { class: 'empty' }, 'How everything in the app looks, in one place: public/tokens.css. Change a token there and every screen follows. Switch Light / Dark at the bottom to see both sets.'),

    el('h2', { class: 'lib-group' }, 'Tokens'),
    part('Surfaces', 'The page, and what is raised from it.', el('div', { class: 'lib-row' }, swatch('--color-bg'), swatch('--color-surface'))),
    part('Text', 'Main text, secondary text, and hints that are never your own words.',
      el('div', { class: 'lib-row' }, swatch('--color-text', null, { text: true }), swatch('--color-text-muted', null, { text: true }), swatch('--color-text-faint', null, { text: true }))),
    part('Lines', 'Surfaces are flat and divided by one thin line. No shadows.',
      el('div', { class: 'lib-row' }, swatch('--color-border'), el('div', { class: 'lib-swatch' }, el('div', { class: 'lib-chip lib-line' }), el('span', { class: 'lib-name' }, '--line'), valueOf('--border-width')))),
    part('Accent', 'One accent on one thing per screen: the action that matters most. This page’s is the button below.',
      el('div', { class: 'lib-row' },
        el('div', { class: 'lib-swatch' }, el('button', { type: 'button', class: 'button button-primary' }, 'Main action'),
          el('span', { class: 'lib-name' }, '--color-accent'), valueOf('--color-accent')),
        el('div', { class: 'lib-swatch' }, el('span', { class: 'lib-name' }, '--color-accent-text'), valueOf('--color-accent-text'),
          el('span', { class: 'empty' }, 'text on the accent')))),
    part('Data colours', 'Only for a calendar’s line and dot, its pale fill, and the Planner’s warning, always with words.',
      el('div', { class: 'lib-row' }, ...['--cal-1', '--cal-2', '--cal-3', '--cal-4', '--cal-5', '--cal-6'].map((t) => swatch(t))),
      el('div', { class: 'lib-row' }, ...['--cal-1-fill', '--cal-2-fill', '--cal-3-fill', '--cal-4-fill', '--cal-5-fill', '--cal-6-fill'].map((t) => swatch(t))),
      el('div', { class: 'lib-row' }, swatch('--color-warning', null, { text: true }), swatch('--color-warning-surface'))),
    part('Type scale', 'Gloock for titles, Plus Jakarta Sans for menus, labels and buttons, Inter for reading.',
      el('div', { class: 'lib-types' }, ...sizes.map(([name, token, family]) => el('div', { class: 'lib-type' },
        el('span', { class: 'lib-type-sample', style: `font-size: var(${token}); font-family: ${family}` }, name),
        el('span', { class: 'lib-name' }, token), valueOf(token))))),
    part('Spacing', 'Steps of 4 px.',
      el('div', { class: 'lib-spaces' }, ...['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12'].map((token) => el('div', { class: 'lib-space' },
        el('span', { class: 'lib-name' }, token), el('span', { class: 'lib-bar', style: `width: var(${token})` }), valueOf(token))))),
    part('Radius', null,
      el('div', { class: 'lib-row' }, ...['--radius-sm', '--radius-md'].map((token) => el('div', { class: 'lib-swatch' },
        el('div', { class: 'lib-chip lib-corner', style: `border-radius: var(${token})` }), el('span', { class: 'lib-name' }, token), valueOf(token))))),

    el('h2', { class: 'lib-group' }, 'Components'),
    part('Button', 'The main action is the accent button under Accent. The others are plain.',
      el('div', { class: 'lib-row' }, demo('Button', el('button', { type: 'button', class: 'button' }, 'Cancel')),
        demo('Button with an icon', el('button', { type: 'button', class: 'button' }, icon('plus'), 'Add')),
        demo('Quiet button', el('button', { type: 'button', class: 'button button-quiet' }, icon('trash'), 'Delete')))),
    part('Text field', null,
      demo('Text field', el('div', { class: 'lib-field' }, icon('search'), el('input', { class: 'search-input', type: 'search', placeholder: 'Search notes', 'aria-label': 'Search notes (an example)' })))),
    part('List row', null,
      el('div', { class: 'lib-rows' }, el('div', { class: 'note-row' }, el('span', { class: 'note-row-title' }, 'Onboarding call with Lena'), el('span', { class: 'note-row-preview' }, 'Lena Fischer from Nordlicht Studio, 14:00')),
        el('div', { class: 'note-row' }, el('span', { class: 'note-row-title' }, 'Pricing thoughts'), el('span', { class: 'note-row-preview' }, 'Three tiers, one for teams')))),
    part('Card', null, el('div', { class: 'lib-card-sample' }, el('div', { class: 'note-card' },
      el('div', { class: 'note-card-title' }, 'Course outline'), el('div', { class: 'note-card-preview' }, 'Module 1: capture. Module 2: organise. Module 3: plan the week.')))),
    part('Chip', 'A choice, the chosen one in bold. Dashed when it is quiet.',
      el('div', { class: 'lib-row' }, demo('Chip', el('button', { type: 'button', class: 'chip' }, 'Upcoming')),
        demo('Chosen', el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true' }, 'Today')),
        demo('Quiet', el('button', { type: 'button', class: 'chip chip-quiet' }, 'Home…')))),
    part('Checkbox', 'A shape, not a colour, says done.',
      el('div', { class: 'lib-row' }, demo('Not ticked', checkbox(false)), demo('Ticked', checkbox(true)))),
    part('Dialog', 'The capture box, as it opens over a screen.',
      el('div', { class: 'lib-dialog' }, el('div', { class: 'capture-box lib-capture' }, el('p', { class: 'lib-dialog-text' }, 'A box that opens over the screen: a thin line, the page colour, no shadow.')))),
    part('Sidebar item', 'The section you are in sits in a panel of the page colour.',
      el('div', { class: 'lib-sidebar' }, el('a', { class: 'sidebar-link', href: '/library' }, icon('notes'), el('span', {}, 'Notes')),
        el('a', { class: 'sidebar-link', href: '/library', 'aria-current': 'page' }, icon('task'), el('span', {}, 'Tasks')))),
    part('Segmented switch', 'One kind of action, two ways: it does it alone, or asks first.',
      el('div', { class: 'switch', role: 'group', 'aria-label': 'Add a task (an example)' },
        el('button', { type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': 'false' }, 'Does it alone'),
        el('button', { type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': 'true' }, 'Asks first'))),
    part('Mention', 'A person or a company named in the text: the face (initials in a circle, a letter in a square) and the current name, a link to their page, never the accent. In a task row and in a note alike; with People in depth switched off it is the name alone.',
      el('p', { class: 'lib-mentions' },
        'Ring ', mentionChip({ kind: 'person', id: 'x', name: 'Lena Fischer' }), ' at ', mentionChip({ kind: 'company', id: 'y', name: 'Nordlicht Studio' }))),
    part('Module row', 'A part of the app you can switch off, in Settings › Modules: its name and what it does, and the Segmented switch (On · Off).',
      el('div', { class: 'permission-row' },
        el('span', { class: 'permission-name' }, 'People in depth', el('span', { class: 'permission-what' }, 'Type @ for a person or @@ for a company in any text.')),
        el('div', { class: 'switch', role: 'group', 'aria-label': 'People in depth (an example)' },
          el('button', { type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': 'true' }, 'On'),
          el('button', { type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': 'false' }, 'Off')))),
    part('Google account row', 'A signed-in Google account in Settings › Google: a letter in a square, the address, one health line in words (never colour alone), and a Segmented switch per permission. A permission Google has not allowed yet says that switching it on asks Google, for that permission only.',
      el('div', {}, googleAccountRow({
        id: 'x', email: 'work@mypractice.com', health: 'ok', health_checked_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        permissions: [{ id: 'mail.read', name: 'Read your mail', granted: true, on: true }, { id: 'mail.send', name: 'Send mail as you', granted: false, on: false }],
      }, { onCheck: () => {}, onDisconnect: () => {} }))),
    part('Speedy mark', 'What an estimate makes a task, on its row: a bolt and the word Speedy for fifteen minutes or less, a box and the word Task for longer, then the minutes. Shape and words, never colour alone. Switch Tasks in depth off and the marks go; the minutes stay as a plain chip.',
      el('div', { class: 'lib-row' }, demo('Speedy', kindMark(10)), demo('Task', kindMark(45)))),
    part('Notice', 'A reminder whose time has come, in the corner over any page, in the Undo bar’s look: the bell, the task and the time, Snooze (10 min, 1 h, tomorrow) and Done. Done ends the alarm; the task it is on stays open, because a reminder is never a task of its own.',
      el('div', { class: 'lib-notice' }, notice({ id: 'x', task_id: 'y', text: 'Send invoice 2026-118', at: '2026-11-09T14:00' }, { example: true }))),
    part('Repeat chip', 'The rule of a repeating task, in words, on its row: the repeat shape and Every Monday, Every weekday, Every 2 weeks. Finishing the task writes the next one by the rule; only that next one is kept, never a pile of copies.',
      el('div', { class: 'lib-row' }, demo('Weekly', repeatChip('every monday')), demo('Every other week', repeatChip('every 2 weeks')))),
    part('Missed row', 'A task that was planned for an earlier day and not done, in the Missed view: its words, its old day, and the four ways out: Today (t), Tomorrow (m), another day (d), let it go (l, with Undo). It never moves by itself.',
      el('div', { class: 'task-rows' }, el('div', { class: 'task-row task-line' },
        el('span', { class: 'task-words' }, 'Update the workshop page ', el('span', { class: 'due-chip' }, 'Tue, Nov 3')),
        el('span', { class: 'task-places' }, el('span', { class: 'task-place task-schedule' },
          ...['Today', 'Tomorrow', 'Other day', 'Let it go'].map((name) => el('button', { type: 'button', class: 'chip' }, name))))))),
    part('World tag', 'Whose a capture is: a circle for the Inner World (your own thought), a square for the Outer World (something someone else made), and the word where there is room. Shape and word, never colour alone. The Inbox keeps the two in two piles: Inner on top, newest first; Outer below, oldest first.',
      el('div', { class: 'lib-row' }, demo('Inner', worldTag('inner', { word: true })), demo('Outer', worldTag('outer', { word: true })))),
    part('Count check row', 'One label counted on both sides: Gmail’s own number, yours, and the word Equal with a tick, or how many are still to fill in bold. The word and the shape carry it, never colour alone. When every row is equal the archive is whole.',
      el('div', { class: 'count-rows', role: 'list' },
        countRow({ label: 'Inbox', gmail: 1122, ours: 1122, equal: true }), countRow({ label: 'Finance', gmail: 161, ours: 160, equal: false, to_fill: 1 }))),
    part('Outbox row', 'A change made here that is on its way to Gmail: what changed (+ a label added, − a label taken off), the mail, and where it is in words: Waiting, Sent to Gmail, Not sent (Gmail changed the same label later) or Failed. The list changes at once; Gmail comes after, so nothing is lost when the network is gone.',
      el('div', { class: 'outbox-rows', role: 'list' },
        outboxRow({ add: [], remove: ['Inbox'], subject: 'This week: 5 ideas and a question', state: 'waiting', problem: '' }),
        outboxRow({ add: ['Starred'], remove: [], subject: 'Brief for the launch event', state: 'sent', problem: '' }))),
    part('Outbox mail row', 'A mail you wrote that has not gone yet, in Mail’s Outbox: who it is to in bold, the subject, and where it is in words (Sending in 7 s, Waits until tomorrow 08:00, Did not go and why), with quiet buttons under it: Undo or Cancel, Send now, Try again, Let it go. The Outbox row’s look, stacked for the narrow list. Nothing is sent again by itself.',
      el('div', { class: 'outbox-rows', role: 'list' },
        outboxMailRow({ id: 'a', to: ['lena@example.com'], subject: 'Course visuals', state: 'waiting', send_at: new Date(Date.now() + 7000).toISOString(), problem: '' }, [el('button', { type: 'button', class: 'button button-quiet' }, 'Undo')]),
        outboxMailRow({ id: 'b', to: ['jonas@example.com'], subject: 'The dates', state: 'failed', send_at: new Date().toISOString(), problem: 'Gmail did not take it (500).' }, [el('button', { type: 'button', class: 'button button-quiet' }, 'Try again'), el('button', { type: 'button', class: 'button button-quiet' }, 'Let it go')]))),
    part('Split tabs', 'The Mail app’s tabs in two rows, each tab with its count. First, alone on its row: Inbox (every conversation with mail in your Inbox), Drafts (mail being written, saved as you type), Sent (every conversation you wrote in, the latest you sent first), Outbox (shown only while something has not gone, with how many failed) and Done. A thin grey line. Then the five splits of the Inbox as small capsules, Important, Calendar, Money, Newsletters and Other. A thick dark line under them parts the tabs from the list. A narrow list lets the second row wrap; nothing scrolls sideways. Tabs, like the Tasks page’s; the rules behind them are code you can read, and the line over an open mail says which one put it there.',
      splitTabs({ counts: { inbox: 7, important: 2, calendar: 1, money: 1, news: 3, done: 40, drafts: 1, sent: 12, outbox: 2 }, failed: 1, current: 'inbox' })),
    part('Key hint', 'A key beside the action it does, so the menu teaches you the keys: the name, and the key in a small box. The Mail commands (Cmd K) and the panel of times (?) are made of these.',
      el('div', { class: 'lib-row' }, demo('With a name', keyHint('e', 'Done')), demo('Alone', keyHint('Cmd K')))),
    part('Sealed frame', 'A mail’s own html, shown with no permissions at all: no script runs, nothing is fetched from the network unless the sender’s images were allowed (per sender, and remembered), and a link opens only when you press it, in a new tab. A quiet bar under it says what was held back; a link whose words name one address while it goes to another is marked. Every later screen that shows outside html uses this frame.',
      el('div', { class: 'lib-sealed' }, sealedFrame('<h3>Five ideas</h3><p>A made-up mail, <b>sealed</b>.</p>'))),
    part('Mail composer', 'The composer that opens under a conversation when you press r: to and subject already set, your words, Send (the screen’s one accent, ⌘↵), Send later (tomorrow 08:00) and “Remind me if no answer in 3 days”. A send waits ten seconds in your outbox with Undo; the first time, Google is asked for the one permission it did not need until now.',
      el('div', { class: 'lib-composer' }, composer({ to: ['lena@nordlicht.example'], subject: 'Re: Onboarding call on Thursday?' }, { accent: false }))),
    part('Opened chip', 'What a read confirmation can know, and only that: “Opened” with the time when something counted opened the mail, grey “Not opened yet” when nothing is known, and what did not count listed under it with its reason (a mail scanner, a privacy proxy). The word is chosen on purpose: the picture cannot prove anyone read a word, so it never says Read.',
      el('div', { class: 'confirm-rows', role: 'list' },
        openedChip({ to: ['lena@nordlicht.example'], subject: 'Re: Onboarding call on Thursday?', opened_at: new Date().toISOString(), opens: 1, not_counted: [{ kind: 'scanner', why: 'a mail scanner', at: new Date(Date.now() - 1_200_000).toISOString() }] }),
        openedChip({ to: ['jonas@hafenkante.example'], subject: 'Dates', opened_at: null, opens: 0, not_counted: [] }))),
    part('Mail row', 'One conversation, one line: the envelope shape, who wrote (bold), the subject, the last words in muted text, and on the right the letter of the account it came to, how many messages it holds and its last day. An unread one has its subject in bold. Kept in your own database; the list of the Mail app is made of these.',
      el('div', { class: 'mail-threads', role: 'list' },
        mailRow({ id: 'x', participants: ['Lena Fischer', 'You'], subject: 'Onboarding call on Thursday?', snippet: 'Perfect, see you Thursday at 10.', message_count: 3, last_at: '2026-11-04T17:00:00.000Z', account_letter: 'W', account_email: 'work@mypractice.com', unread: true }),
        mailRow({ id: 'y', participants: ['Billing'], subject: 'Invoice 2026-114', snippet: 'Your invoice 2026-114 for 120.00 EUR is attached.', message_count: 1, last_at: '2026-10-28T08:00:00.000Z' }))),
    part('Timeline row', 'One thing that happened: its kind’s shape, its time, one line and where it lives. The whole row opens the thing where it lives. Kinds are told apart by shape and word, never colour.',
      el('div', { class: 'timeline-list' },
        timelineRow({ kind: 'note', at: '2026-11-08T09:12:00', text: 'Onboarding call with Lena', where: 'Note', href: '/library' }),
        timelineRow({ kind: 'task', at: '2026-11-08T08:40:00', text: 'Send the proposal', where: 'Task done', href: '/library' }),
        timelineRow({ kind: 'event', at: '2026-11-08T08:00:00', text: 'Proposal review', where: 'Event', href: '/library' }))),
    part('Now line', 'A thin line with the word Now: what is still ahead today sits above it, what has happened below.',
      el('div', { class: 'timeline-list' },
        timelineRow({ kind: 'event', at: '2026-11-08T12:30:00', text: 'Lunch with Marta', where: 'Event', href: '/library' }),
        nowLine(),
        timelineRow({ kind: 'capture', at: '2026-11-08T09:05:00', text: 'Ask Jonas about the venue', where: 'Capture', href: '/library' }))),
    part('Log line', 'At the top of a person’s or company’s Timeline: what happened outside the app, in one line. A kind, a day (today unless changed), one sentence and Log, the one accent of that tab. It looks like the Tasks page’s add bar.',
      logLine({ about: { kind: 'person', id: 'example' }, name: 'Jonas', accent: false }).element),
    part('Cadence chip', 'Under a person’s name: how often you want to be in touch, and how many days are left or overdue (bold when overdue, always in words). Pressing it shows the choices; it is quiet and dashed when there is no rhythm. Last in touch is never typed: it comes from the logged lines.',
      el('div', {},
        cadenceChip({ id: 'x', cadence_days: 7, days_left: -2, last_in_touch: '2026-10-30' }).element,
        cadenceChip({ id: 'y', cadence_days: null, days_left: null, last_in_touch: null }).element)),
    part('Reconnect row', 'In People, above everyone: a person with a rhythm, how long until they are due, and Remind me when they are due (a task for tomorrow).',
      el('div', { class: 'reconnect-list' },
        el('div', { class: 'reconnect-row', 'data-due': 'true' },
          el('a', { class: 'person-row', href: '/library' }, el('span', { class: 'face face-person face-small', 'aria-hidden': 'true' }, 'JW'),
            el('span', { class: 'person-row-text' }, el('span', { class: 'person-row-name' }, 'Jonas Weber'), el('span', { class: 'person-row-sub' }, 'Weekly · last in touch 2026-10-30')),
            el('span', { class: 'person-row-count reconnect-due' }, '2 days overdue')),
          el('button', { type: 'button', class: 'button' }, 'Remind me')))),
    part('Merge pair', 'Two entries of one person side by side: Keep this entry on top, then a choice per row (the left, the right, or both for emails, phones, how we met and notes). The chosen cell is bold on the surface colour.',
      mergePair({
        a: { id: 'a', name: 'Mara Kühn', role: 'Producer', company_id: null, company_name: null, emails: 'mara@home.de', phones: '', how_met: '', body: '', mention_count: 2, origin: 'typed' },
        b: { id: 'b', name: 'Mara Kuehn (Nordlicht)', role: 'Head of production', company_id: 'c', company_name: 'Nordlicht', emails: 'mara@nordlicht.de', phones: '+49 170 1234567', how_met: '', body: '', mention_count: 1, origin: 'imported' },
      }).element),
    part('Mic pill', 'Dictation: a small pill with four states. Idle says which key to hold; listening shows a level line and the words as they come; writing; and done says where the words went. Listening, writing and done float at the foot of the window.',
      el('div', { class: 'lib-pills' },
        el('span', { class: 'mic-pill' }, icon('mic'), el('span', {}, 'Hold Right ⌥ to dictate')),
        el('span', { class: 'mic-pill', 'data-state': 'listening' }, icon('mic'), el('span', { class: 'mic-level', 'aria-hidden': 'true' }, el('span', { class: 'mic-level-bar', style: 'width: 60%' })), el('span', { class: 'mic-words' }, '…met Lena about the work')),
        el('span', { class: 'mic-pill', 'data-state': 'writing' }, icon('mic'), el('span', { class: 'mic-words' }, 'Writing…')),
        el('span', { class: 'mic-pill', 'data-state': 'done' }, icon('mic'), el('span', { class: 'mic-words' }, 'Wrote 12 words in Text · Onboarding call')))),
    part('Glossary row', 'A term for the speech to text: a Hint (a word to expect) or a Fix (what it keeps hearing, written as the term), and where it came from. A bin on a row you can remove, with Undo.',
      el('div', { class: 'glossary-list' },
        glossaryRow({ kind: 'fix', term: 'Nordlicht', heard_as: 'North light', source: 'learned' }, { onDelete: () => {} }),
        glossaryRow({ kind: 'hint', term: 'Hafenkante', heard_as: '', source: 'typed' }, { onDelete: () => {} }),
        glossaryRow({ kind: 'hint', term: 'Lena Fischer', heard_as: '', source: 'person' }, { onDelete: () => {} }))),
    part('Kind chip', 'A Tab that switches one kind on and off: pressed is on (bold, on the surface colour). It carries the kind’s shape.',
      el('div', { class: 'tabs' },
        el('button', { type: 'button', class: 'tab', 'aria-pressed': 'true' }, icon('notes'), ' Notes'),
        el('button', { type: 'button', class: 'tab', 'aria-pressed': 'false' }, icon('inbox'), ' Captures'))),
    part('Approval card', 'What your assistant wants to do, waiting for your yes. Solid when decided; the buttons are plain.',
      el('div', { class: 'lib-chat' },
        el('div', { class: 'action-card', 'data-kind': 'step', 'data-state': 'proposed', role: 'group', 'aria-label': 'An approval card (an example)' },
          el('p', { class: 'action-what' }, icon('lock'), el('span', {}, 'Wants to: Read outside its folder: /Users/me/Documents/plan.txt'), el('em', { class: 'plan-free' }, 'Waiting for you')),
          el('div', { class: 'action-buttons' },
            el('button', { type: 'button', class: 'button' }, 'Allow once'), el('button', { type: 'button', class: 'button' }, 'Always allow'), el('button', { type: 'button', class: 'button button-quiet' }, 'No'))))),
    part('Draft card', 'A mail your assistant drafted, waiting for your Send. Nothing is sent until you press it; Edit opens it in the composer. Its limits are in code (Settings).',
      el('div', { class: 'lib-chat' },
        el('div', { class: 'action-card', 'data-kind': 'mail_send', 'data-state': 'proposed', role: 'group', 'aria-label': 'A draft card (an example)' },
          el('p', { class: 'action-what' }, icon('mail'), el('span', {}, 'Send a mail to lena@nordlicht.example: “Re: Onboarding call on Thursday?”'), el('em', { class: 'plan-free' }, 'Waiting for you')),
          el('div', { class: 'action-preview' }, el('p', { class: 'action-preview-text' }, 'Thursday works for me, see you at 10')),
          el('div', { class: 'action-buttons' },
            el('button', { type: 'button', class: 'button' }, 'Send'), el('a', { class: 'button', href: '/library' }, 'Edit'), el('button', { type: 'button', class: 'button button-quiet' }, 'Dismiss'))))),
    part('Sentence preview', 'What Enter will make, as chips, while you type an event in words (Calendar in depth): the title, the day, the time, the length and the people it knows. A dashed chip is a guess, with the guess in words, so a wrong one is fixed before anything exists.',
      el('div', { class: 'lib-chat' },
        sentencePreview(readEvent('lunch with Lena at the lake thu 12:30 1h', { today: '2026-11-09', names: [{ id: 'lena', name: 'Lena Fischer' }] })),
        sentencePreview(readEvent('Call with the venue', { today: '2026-11-09', names: [] })))),
    part('Answer bar', 'Your answer to an invitation in Google Calendar (Calendar in depth): Yes, Maybe and No, with your choice raised. An invitation waits dashed in your calendar until you answer, and the answer goes to the organiser through the same outbox as every change.',
      el('div', { class: 'lib-chat lib-answer-bar' }, answerBar('needsAction', { onAnswer: () => {} }), answerBar('accepted', { onAnswer: () => {} }), answerBar('declined'))),
    part('Sync mark', 'The G (Calendar in depth) says where a Google event is: the plain G when it is in Google, dashed while a change of it waits to go, a double ring when it changed in both places and the change waits for you, struck when it was not saved after five tries. Each also has its words in its tooltip and in the Google changes list.',
      el('div', { class: 'lib-chat lib-sync-mark' },
        ...[['', 'In Google'], ['waiting', 'Waiting to go'], ['clash', 'Changed in both places'], ['failed', 'Not saved to Google yet']].map(([state, words]) => el('p', { 'data-sync': state }, gMark(state), words)))),
    part('G mark', 'A small G in a square on an event that is in Google Calendar (Calendar in depth): on the Calendar, in the Planner’s day, in the Order and in the hours. A shape and a letter, so it still tells Google’s events from yours with the colour taken away.',
      el('div', { class: 'lib-chat lib-g-mark' }, el('p', {}, gMark(), 'Kick-off Nordlicht'), el('p', {}, 'Weekly review (not in Google: no mark)'))),
    part('Template chip', 'A routine (Calendar in depth): a name and a length you set up once, such as a run or a morning of deep work. Drag it into a day of the Planner: it becomes a task there, with a dotted outline, and never an event on your Calendar.',
      el('div', { class: 'lib-chat' }, el('div', { class: 'routine-chips' }, templateChip({ id: 'run', title: 'Run', minutes: 45 }), templateChip({ id: 'deep', title: 'Deep work', minutes: 180 }, { onRemove: () => {} })))),
    part('Lens switch', 'Two Switches in the Planner’s head (Calendar in depth): Order or Hours, and in Hours one day, three days or the week. V switches the lens from the keyboard and V again comes back to where you were.',
      (() => { const lens = lensControls(); lens.show({ lens: 'hours', range: '3' }); return el('div', { class: 'lib-chat' }, lens.bar); })()),
    part('Task block', 'A task drawn as a block (Calendar in depth): dashed, because a task can move, as tall as its estimate. When the gap it sits in is over, the tasks share it and each is shorter than it asked for, with an amber outline and the reason in its tooltip.',
      el('div', { class: 'lib-chat' },
        taskBlock({ id: 'a', minutes: 60, shown: 60 }, { text: 'Draft the workshop agenda', done: false }, { rowed: true }),
        taskBlock({ id: 'b', minutes: 60, shown: 50 }, { text: 'Send the offer to Nordlicht', done: false }, { rowed: true }),
        taskBlock({ id: 'c', minutes: 30, shown: 30 }, { text: 'Book the venue', done: true }, { rowed: true }))),
    part('Hour grid', 'Several days side by side in hours (Calendar in depth): the hours down the left, a column a day, events solid at their times, tasks dashed in the gaps between them. The one picture the Order and the Hours both read from.',
      (() => {
        const at = (h, m = 0) => h * 60 + m;
        const day = (name, anchors, tasks) => ({ day: name, from: at(9), to: at(16), words: new Map(tasks.map((t) => [t.id, { text: t.text, done: false }])),
          order: dayOrder({ from: at(9), to: at(16), anchors, tasks: tasks.map((t) => ({ id: t.id, start: t.start, minutes: t.minutes })) }) });
        return el('div', { class: 'lib-chat' }, hourGrid([
          day('Tue', [{ id: 'e1', title: 'Call with Lena', start: at(10), end: at(10, 30), kind: 'event' }, { id: 'e2', title: 'Lunch', start: at(12), end: at(13), kind: 'event' }],
            [{ id: 't1', text: 'Draft the agenda', start: at(13), minutes: 90 }, { id: 't2', text: 'Send the offer', start: at(14), minutes: 90 }, { id: 't3', text: 'Plan the venue', start: at(15), minutes: 60 }]),
          day('Wed', [{ id: 'e3', title: 'Dentist', start: at(11), end: at(12), kind: 'event' }], [{ id: 't4', text: 'Write the offer', start: at(9), minutes: 120 }]),
        ], { hourPx: 28, label: (c) => c.day }));
      })()),
    part('Calendar link row', 'Another calendar added by its iCal link: its colour dot (press to change it), its name, when it was last read or what went wrong, Read now and Remove. Read only: it is never written to, and its events show beside yours in its colour.',
      el('div', { class: 'cal-calendars' },
        calendarLinkRow({ name: 'Family', colour: 2, fetched_at: new Date(Date.now() - 4 * 60_000).toISOString(), problem: '' }),
        calendarLinkRow({ name: 'School', colour: 3, fetched_at: null, problem: 'The link did not answer (404).' }))),
    part('Habit rhythm', 'A Habit: its shape is an arrow that comes round, in My Life’s green, and its row says how often in words under its name. On its page, how often is a number, “times a” and week or month (a week takes at most seven), with what counts as done under it.',
      el('div', { class: 'lib-chat' },
        el('div', { class: 'life-frame' },
          el('div', { class: 'life-item-row' }, icon('habit'),
            el('span', { class: 'life-item-text' }, el('span', { class: 'life-item-title' }, 'Run 3× a week'), el('span', { class: 'life-item-sub' }, '3× a week · Easy pace, no watch')))),
        el('div', { class: 'contact-details' },
          el('label', { class: 'detail-label' }, 'How often'),
          el('div', { class: 'life-cadence' },
            el('input', { class: 'detail-input life-times', type: 'number', value: '3', 'aria-label': 'How many times (example)', readonly: true }),
            el('span', {}, 'times a'),
            el('select', { class: 'detail-input', 'aria-label': 'Per week or per month (example)' }, el('option', {}, 'week'), el('option', {}, 'month'))),
          el('label', { class: 'detail-label' }, 'Counts as done when'),
          el('textarea', { class: 'detail-input detail-lines', rows: 2, readonly: true, 'aria-label': 'Counts as done when (example)' }, 'Twenty minutes or more, outside')))),
    part('Invitation card', 'An invitation in a mail: the meeting, who asked, and three keys. Answered, it says in words what happened: in your Calendar, and that the answer went by mail. Shape and words, never colour.',
      el('div', { class: 'lib-chat' },
        inviteCard({ summary: 'Kick-off Nordlicht', start: '2026-10-15T10:00', end: '2026-10-15T11:00', all_day: false, location: 'Nordlicht Studio', organizer: { name: 'Jonas Weber', email: 'jonas@hafenkante.example' }, attendees: [{}, {}], cancelled: false, answer: null }),
        inviteCard({ summary: 'Kick-off Nordlicht', start: '2026-10-15T10:00', end: '2026-10-15T11:00', all_day: false, location: 'Nordlicht Studio', organizer: { name: 'Jonas Weber', email: 'jonas@hafenkante.example' }, attendees: [{}, {}], cancelled: false,
          answer: { said: 'Yes', word: 'Accepted', in_calendar: true, send: { state: 'sent', problem: '' } } }))),
    part('Outline bullet', 'A bullet of a note written as an outline (Writing and thinking): the dot, the fold triangle that appears when the pointer is on it (always there when it is folded) and the words; a folded one ends in an ellipsis. The zoom path leads back out of a zoom.',
      el('div', { class: 'lib-chat' },
        el('div', { class: 'note-body lib-outline' },
          el('ul', {},
            el('li', {}, el('button', { type: 'button', class: 'fold-toggle is-open', 'aria-label': 'Fold: put its bullets away', 'aria-expanded': 'true' }, icon('chevron')), el('p', {}, 'Format'),
              el('ul', {}, el('li', {}, el('p', {}, 'One exercise')), el('li', {}, el('p', {}, 'Two exercises')))),
            el('li', { class: 'is-folded' }, el('button', { type: 'button', class: 'fold-toggle', 'aria-label': 'Open: show its bullets', 'aria-expanded': 'false' }, icon('chevron')), el('p', {}, 'Agenda'),
              el('ul', {}, el('li', {}, el('p', {}, 'Talks')))))),
        el('nav', { class: 'zoom-path', 'aria-label': 'Zoom path (an example)' },
          el('button', { type: 'button', class: 'button button-quiet' }, 'Ideas for the autumn workshop'), el('span', { class: 'zoom-sep', 'aria-hidden': 'true' }, '›'),
          el('button', { type: 'button', class: 'button button-quiet', 'aria-current': 'true' }, 'Format')))),
    part('Block embed', 'A link to a bullet, alone in its line: the bullet and what is under it, in a frame, with the note it lives in. It is drawn from the bullet each time. In a line of words the link is the bullet’s words, underlined. A bullet that is used says “Used in N places”.',
      el('div', { class: 'lib-chat' },
        el('div', { class: 'note-body' }, el('span', { class: 'block-ref is-embed' }, el('span', { class: 'block-embed' },
          el('span', { class: 'block-embed-words' }, 'Package: 3 days for 4800 EUR'),
          el('span', { class: 'block-embed-children' }, el('span', { class: 'block-embed-child' }, 'Prep and a follow-up call')),
          el('a', { class: 'block-embed-from', href: '/library' }, 'From Pricing thoughts'))),
        el('p', {}, 'See ', el('span', { class: 'block-ref' }, el('a', { class: 'block-ref-link', href: '/library' }, 'Package: 3 days for 4800 EUR')), ' and ', el('span', { class: 'block-ref is-missing' }, 'Removed passage'), ' ', el('button', { type: 'button', class: 'used-in' }, 'Used in 2 places'))))),
    part('Comment thread', 'A comment on words of a note, under the text: the quoted words, the comment, replies signed You or Your assistant, and one decision: ask your assistant now, or Later (its list). The words themselves carry a quiet dotted underline.',
      el('div', { class: 'lib-chat' },
        commentThread({ id: 'x', anchor: 'Price it as a fixed package', body: 'Is this price too low for Nordlicht?', author: 'me', ask: '', resolved: false, created_at: new Date().toISOString(), replies: [] }),
        commentThread({ id: 'y', anchor: 'Two quiet mornings', body: 'Why only mornings?', author: 'me', ask: 'answered', resolved: false, created_at: new Date().toISOString(),
          replies: [{ id: 'z', author: 'assistant', body: 'Because the afternoons are for meetings.', created_at: new Date().toISOString() }] }))),
    part('Version list', 'The versions of a note, newest first: its number, what changed in a few words, who saved it and when. Pick two to see the words that changed (added words are doubly underlined, removed words struck through); pick one to read it and Restore it. Never colour alone.',
      el('div', { class: 'lib-chat' },
        versionList([
          { id: 'a', seq: 3, author: 'assistant', label: '', summary: '12 words added', created_at: new Date().toISOString() },
          { id: 'b', seq: 2, author: 'me', label: 'Restored from version 1', summary: '4 words removed', created_at: new Date().toISOString() },
          { id: 'c', seq: 1, author: 'me', label: '', summary: 'First version', created_at: new Date().toISOString() },
        ], { selected: ['a', 'b'] }),
        diffView([{ t: 'same', text: 'Three tiers felt like ' }, { t: 'del', text: 'too many' }, { t: 'add', text: 'one too many' }, { t: 'same', text: ' for this workshop.' }]))),
    part('Clash box', 'A line you and your assistant both changed: yours on the left (solid, and in the note for now), the assistant’s on the right (dashed), and three buttons. Never colour alone: the side is named.',
      el('div', { class: 'lib-chat' }, clashBox({ mine: 'Two quiet mornings', theirs: 'Meetings only after lunch' }))),
    part('Board card and connector', 'A card on a board: its words, or a note, person or task shown live (with its kind). Text sits on the canvas without a box. Your assistant’s cards carry a dashed outline and a small tag, and its arrows are dashed. An arrow leaves one card and points at another.',
      el('div', { class: 'lib-chat' },
        el('div', { class: 'lib-board' },
          boardCard({ id: 'a', kind: 'card', text: 'Welcome', x: 10, y: 10, w: 130, h: 50, origin: 'typed' }),
          boardCard({ id: 'b', kind: 'card', text: 'Pricing case', x: 190, y: 10, w: 190, h: 50, origin: 'typed', live: { kind: 'note', title: 'Pricing thoughts', sub: 'Package: 3 days for 4800 EUR' } }),
          boardCard({ id: 'c', kind: 'card', text: 'A break', x: 430, y: 10, w: 130, h: 50, origin: 'assistant' }),
          boardCard({ id: 'd', kind: 'text', text: 'Ask about the venue', x: 10, y: 120, w: 220, h: 40, origin: 'typed' }),
          el('span', { class: 'lib-arrow', 'aria-hidden': 'true' }, '→')))),
    part('Import report', 'What a run of an import did, in words and numbers: how many came in, were already here, were kept because you edited them, and that none were doubled. Never a colour: the words say it.',
      el('div', { class: 'lib-chat' },
        importReport({ kind: 'obsidian', source: 'Autumn vault', imported: 0, already: 11, doubled: 0, kept: 1, kept_titles: ['Workshop venues in Hamburg'], created_at: new Date().toISOString() }),
        importReport({ kind: 'dayone', source: 'Journal.json', added: 30, already: 0, doubled: 0, days: 30, first: '2026-09-01', last: '2026-09-30', created_at: new Date().toISOString() }))),
    part('Ink layer', 'The pen on a board: every stroke is kept with the pressure and time of each point, and drawn thicker where the pen pressed harder. Once the handwriting has become words the ink fades below them and is never deleted.',
      el('div', { class: 'lib-chat' },
        (() => {
          const NS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(NS, 'svg');
          svg.setAttribute('viewBox', '0 0 300 90');
          svg.setAttribute('class', 'lib-ink');
          svg.setAttribute('aria-label', 'Ink: a line pressed lightly, then hard; below it a faded stroke');
          const stroke = (points, faded) => { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', strokePath(points)); path.setAttribute('fill', 'currentColor'); path.setAttribute('class', `ink-stroke${faded ? ' is-faded' : ''}`); svg.append(path); };
          stroke(Array.from({ length: 24 }, (_, i) => [10 + i * 11, 30 + Math.sin(i / 3) * 8, 0.15 + (i / 23) * 0.85, i * 20]), false);
          stroke(Array.from({ length: 24 }, (_, i) => [10 + i * 11, 70 + Math.sin(i / 3) * 6, 0.5, i * 20]), true);
          return svg;
        })())),
    part('Mail chip', 'On a task that came from a conversation: a link back to it. On the open mail, the Task line says where it went.',
      demo('Mail chip', el('a', { class: 'due-chip mail-chip', href: '/library' }, icon('mail'), ' Mail'))),
    part('Chat bubble', 'Yours on the right on the surface colour, the assistant’s on the left. Shape and side tell them apart, never colour.',
      el('div', { class: 'lib-chat' },
        el('div', { class: 'chat-bubble is-user' }, el('p', { class: 'chat-text' }, 'What did I write about Lena?')),
        el('div', { class: 'chat-bubble is-assistant' }, el('p', { class: 'chat-text' }, 'Two notes and a journal entry mention her.')))),
    part('Question chip', 'An example question, as a rounded chip.',
      demo('Question chip', el('button', { type: 'button', class: 'question-chip' }, 'What is on today?'))),
    part('Citation', 'A page an answer used: its kind’s shape, name and kind. It opens the page.',
      el('div', { class: 'citations' }, el('a', { class: 'citation', href: '/library' }, icon('notes'), el('span', { class: 'citation-title' }, 'Onboarding call with Lena'), el('span', { class: 'citation-kind' }, 'note')))),
    part('Empty state', null, el('p', { class: 'empty' }, 'No notes yet.')),
  );

  // Light/Dark changes the values: read them again.
  const watch = new MutationObserver(() => {
    if (!screen.isConnected || !live.length || !live[0][0].isConnected) { watch.disconnect(); return; }
    for (const [node, token] of live) node.textContent = value(token);
  });
  watch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}
