// Alerts (2026-11-22, the owner's wish): when something new happens, a normal Mac or Windows alert, shown by the page
// (public/alerts.js) while Sovran Central is open, and the count in the sidebar goes up. Clicking one opens that post.
//
// Each kind has its own switch (settings alerts.switches). A student's kinds, from the Sovran cloud (group_feed.alerts,
// cloud/group-alerts.sql, asked with the library key through group-feed.js):
//   news     a new announcement, homework or reminder from Daniel            on
//   reply    someone commented on their post, or replied to them            on
//   due      homework due today or tomorrow that isn't ticked done          on   (said once for each homework)
//   answer   Daniel has dealt with something they told him                  on
//   feed     any new post in the Circle                                     off  (so it isn't noisy)
// and one from this computer: update, a new version of Sovran Central is ready (on), which public/update-nudge.js says.
// APP Daniel (the guide key) has its own: report (a new student report), flag (a post was flagged), reply (a student
// commented on your post).
//
// What this computer remembers: the switches, the moment it last asked (alerts.since, the cloud's own clock), and the
// homework it has already said is due (alerts.due_said). Nothing of what the alerts say is kept.

import { randomUUID } from 'node:crypto';
import { askCloud, groupOn, isGuideApp } from './group-feed.js';

const STUDENT_KINDS = [
  { id: 'news', label: 'A new announcement from Daniel', on: true },
  { id: 'reply', label: 'Someone replied to your post or comment', on: true },
  { id: 'due', label: 'Homework is due tomorrow (if not ticked done)', on: true },
  { id: 'answer', label: 'Daniel replied to, or dealt with, something you told him', on: true },
  { id: 'update', label: 'A new version of Sovran Central is ready', on: true },
  { id: 'feed', label: 'Any new post in the Circle', on: false },
];
const GUIDE_KINDS = [
  { id: 'report', label: 'A student sent you a report, or answered your reply', on: true },
  { id: 'claude', label: 'Claude answered your question about a report', on: true },
  { id: 'flag', label: 'A student flagged a post or comment', on: true },
  { id: 'reply', label: 'A student commented on your post', on: true },
];
const SWITCHES = 'alerts.switches';
const SINCE = 'alerts.since';
const DUE_SAID = 'alerts.due_said';
const kinds = () => (isGuideApp() ? GUIDE_KINDS : STUDENT_KINDS);
const fail = (status, message) => Object.assign(new Error(message), { status });

function readSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
function writeSetting(db, key, value) {
  const time = new Date().toISOString();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, key, JSON.stringify(value));
}

// Every kind with its switch: [{ id, label, on }].
export function alertSwitches(db) {
  const saved = readSetting(db, SWITCHES, {});
  return kinds().map((k) => ({ ...k, on: typeof saved?.[k.id] === 'boolean' ? saved[k.id] : k.on }));
}
export function setAlertSwitch(db, input) {
  const kind = kinds().find((k) => k.id === input?.id);
  if (!kind || typeof input?.on !== 'boolean') throw fail(400, 'Pick an alert and On or Off.');
  const saved = readSetting(db, SWITCHES, {});
  writeSetting(db, SWITCHES, { ...(saved && typeof saved === 'object' ? saved : {}), [kind.id]: input.on });
  return alertSwitches(db);
}

const localDay = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const short = (text, max = 140) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const tabPath = (tab) => (tab === 'news' ? 'announcements' : 'circle');
const REPORT_KINDS = { broken: 'Something isn’t working', off: 'Something seems off here', question: 'A question', other: 'Something else' };

// What one alert says, and where clicking it goes. null: not one to say.
export function alertWords(item, { today, tomorrow }) {
  const at = item.post ? `/group/${tabPath(item.tab)}#post-${item.post}` : null;
  const by = item.author || 'Someone';
  switch (item.kind) {
    case 'news': {
      const title = { homework: `New homework from ${by}`, reminder: `A reminder from ${by}` }[item.post_kind] ?? `New from ${by}`;
      return { title, body: short(item.text) || 'Open Group Circle to read it.', path: at };
    }
    case 'feed': return { title: `${by} posted in the Circle`, body: short(item.text) || (item.pictures ? 'A picture' : ''), path: at };
    case 'reply': {
      if (isGuideApp()) return { title: `${by} commented on your post`, body: short(item.text), path: at };
      return { title: item.on_mine ? `${by} commented on your post` : `${by} replied to you`, body: short(item.text), path: at };
    }
    case 'due': {
      if (item.due_on !== today && item.due_on !== tomorrow) return null;
      return { title: item.due_on === today ? 'Homework due today' : 'Homework due tomorrow', body: short(item.text), path: at };
    }
    case 'answer': {
      const path = item.report ? `/help#report-${item.report}` : '/help';
      if (item.reply) return { title: 'Daniel replied', body: short(item.text), path, action: 'Read and answer' };
      return { title: 'Daniel has dealt with what you told him', body: short(item.text) || REPORT_KINDS[item.report_kind] || '', path };
    }
    case 'report': {
      const path = item.report ? `/group/reports?status=all#report-${item.report}` : '/group/reports';
      if (item.followup) return { title: `${by} answered you`, body: short(item.text), path, action: 'Reply', reply: true };
      return { title: `${by} sent you a report`, body: short(item.text) || REPORT_KINDS[item.report_kind] || '', path, action: 'Reply', reply: true };
    }
    case 'claude': return { title: `Claude answered about ${by}’s report`, body: short(item.text), path: item.report ? `/group/reports?status=all#report-${item.report}` : '/group/reports' };
    case 'flag': return { title: `Something ${by} wrote was flagged`, body: short(item.text), path: at };
    default: return null;
  }
}

// The alerts not said yet, ready to show: [{ id, kind, title, body, path }]. Asking moves the moment on, so each is
// said once. Nothing while Group Circle is off or can't be reached (it is asked again next time).
// addToInbox(text): the app's own (captures.js createCapture). A reply from Daniel also leaves a line in the student's
// Inbox (2026-11-24), whatever the alert switch says, so it is there after the alert has gone.
export async function takeAlerts(db, { now = new Date(), addToInbox = null } = {}) {
  if (!groupOn(db)) return { items: [] };
  const since = readSetting(db, SINCE, null);
  let answer;
  try { answer = await askCloud(db, { action: 'alerts', since: typeof since === 'string' ? since : null }); } catch { return { items: [] }; }
  if (typeof answer?.now === 'string') writeSetting(db, SINCE, answer.now);
  const first = typeof since !== 'string'; // the very first ask only sets the moment, and says what is due
  const on = Object.fromEntries(alertSwitches(db).map((k) => [k.id, k.on]));
  const today = localDay(now);
  const tomorrow = localDay(new Date(now.getTime() + 86_400_000));
  const dueSaid = new Set(readSetting(db, DUE_SAID, []).map(String));
  const items = [];
  for (const item of Array.isArray(answer?.items) ? answer.items : []) {
    if (!first && addToInbox && !isGuideApp() && item.kind === 'answer' && item.reply) {
      try { addToInbox(`Daniel replied to what you told him: “${short(item.text, 300)}” Read it and answer on Help, in your sidebar.`); } catch { /* the alert still shows */ }
    }
    if (!on[item.kind] || (first && item.kind !== 'due')) continue;
    if (item.kind === 'due') {
      const key = `${item.post}:${item.due_on}`;
      if (dueSaid.has(key)) continue;
      const words = alertWords(item, { today, tomorrow });
      if (!words) continue;
      dueSaid.add(key);
      items.push({ id: `due-${key}`, kind: 'due', ...words });
      continue;
    }
    const words = alertWords(item, { today, tomorrow });
    if (words) items.push({ id: `${item.kind}-${item.post ?? item.report ?? ''}-${item.comment ?? ''}-${item.at ?? ''}`, kind: item.kind, ...words });
  }
  writeSetting(db, DUE_SAID, [...dueSaid].slice(-100));
  return { items: items.slice(0, 10) };
}
