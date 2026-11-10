// The course page (Sovran Advisor, 2026-11-10, the owner's wish): a Course link in the sidebar opens the
// course's own page online (the session replays, the homework, questions), in the browser. The page lives
// elsewhere; the app only knows its address. COURSE_URL is the address every install starts with: set it
// here and publish an update, and every student's link follows. Another address can be set in Settings
// (kept in this computer's database, settings: course.url); clearing it goes back to COURSE_URL. Only a
// plain https address is ever used. With no address at all the link isn't shown.

import { randomUUID } from 'node:crypto';

export const COURSE_URL = '';
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

// A plain https address, or null: no other kind of link, no sign-in details in it.
function plainHttps(text) {
  try {
    const parsed = new URL(String(text ?? '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.href.length > 2000) return null;
    return parsed.href;
  } catch { return null; }
}

function ownUrl(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'course.url' AND deleted_at IS NULL").get();
  try { return row ? plainHttps(JSON.parse(row.value)) ?? '' : ''; } catch { return ''; }
}

export const getCourse = (db) => {
  const own = ownUrl(db);
  return { url: own || plainHttps(COURSE_URL) || '', own: Boolean(own) };
};

export function setCourseUrl(db, url) {
  const text = String(url ?? '').trim();
  const value = text ? plainHttps(text) : '';
  if (value === null) throw fail(400, 'Paste the whole address of the course page, starting with https://');
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, 'course.url', JSON.stringify(value));
  return getCourse(db);
}
