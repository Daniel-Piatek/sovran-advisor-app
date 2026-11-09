// An event from a sentence (advanced/calendar/5): one pure function, no model, no clock and no network inside it, so
// the same words always give the same event, on every key and again on Enter.
//   readEvent("lunch with Lena at the lake thu 12:30 1h", { today: '2026-11-09', names: [{ id, name }] })
//   → { title, day, start, minutes, end, people, found, starts_at, ends_at }
// It finds a day (today, tomorrow, a weekday, a date, "in 3 days"), a time ("12:30", "2pm", "at 14", a span "9-10"), a length
// ("45m", "1h", "1h30", "90 min", "half an hour") and the people the app knows by name. Everything else is the title, in the
// order it was written: words it does not understand are never dropped ("at the lake" stays). People stay in the title too.
// With no time it says 9:00 and that it guessed; with no length it says an hour.

const DAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const has = (table, word) => Object.hasOwn(table, word);
const pad = (n) => String(n).padStart(2, '0');
const DEFAULT_START = '09:00';
const DEFAULT_MINUTES = 60;

const atNoon = (day) => new Date(`${day}T12:00:00`);
const dayOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const plusDays = (day, n) => { const d = atNoon(day); d.setDate(d.getDate() + n); return dayOf(d); };
const validDay = (y, m, d) => { const date = new Date(y, m - 1, d, 12); return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };
const clean = (word) => word.replace(/^[("'“]+|[)"'”.,;:!?]+$/g, '');
const lower = (word) => clean(word).toLowerCase();

// The next day with this weekday: today when it is today's, else the coming one; `after` skips today ("next monday").
function weekdayOn(today, weekday, { after = false } = {}) {
  const diff = (weekday - atNoon(today).getDay() + 7) % 7;
  return plusDays(today, after && diff === 0 ? 7 : diff);
}
// A date without a year is the next time that date comes (this year's, else next year's).
function nextDate(today, month, day) {
  const year = Number(today.slice(0, 4));
  const first = validDay(year, month, day);
  if (!first) return null;
  return first >= today ? first : validDay(year + 1, month, day);
}

// A time of day from one word: 12:30, 12:30pm, 2pm, 14:00. null when it is not one. `bare` allows a plain hour ("at 14").
function timeFrom(word, { bare = false } = {}) {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/.exec(lower(word));
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const suffix = m[3]?.[0];
  if (!m[2] && !suffix && !bare) return null;
  if (minute > 59) return null;
  if (suffix) { if (hour < 1 || hour > 12) return null; hour = (hour % 12) + (suffix === 'p' ? 12 : 0); }
  else if (!m[2]) { if (hour > 23) return null; if (hour >= 1 && hour <= 6) hour += 12; } // a bare "at 2" is the afternoon
  else if (hour > 23) return null;
  return { minutes: hour * 60 + minute, suffix: Boolean(suffix), explicit: Boolean(m[2]) };
}

// A length from a word (and maybe the next): 45m, 1h, 1.5h, 1h30, 90min, "half an hour".
function lengthFrom(words, i) {
  const w = lower(words[i]);
  let m = /^(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours)$/.exec(w);
  if (m) return { minutes: Math.round(Number(m[1]) * 60), used: 1 };
  m = /^(\d+)h(\d{1,2})m?$/.exec(w);
  if (m) return { minutes: Number(m[1]) * 60 + Number(m[2]), used: 1 };
  m = /^(\d+)(m|min|mins|minute|minutes)$/.exec(w);
  if (m) return { minutes: Number(m[1]), used: 1 };
  m = /^(\d+(?:\.\d+)?)$/.exec(w);
  if (m && /^(h|hr|hrs|hour|hours)$/.test(lower(words[i + 1] ?? ''))) return { minutes: Math.round(Number(m[1]) * 60), used: 2 };
  if (m && /^(m|min|mins|minute|minutes)$/.test(lower(words[i + 1] ?? ''))) return { minutes: Number(m[1]), used: 2 };
  if (w === 'half' && lower(words[i + 1] ?? '') === 'an' && /^hours?$/.test(lower(words[i + 2] ?? ''))) return { minutes: 30, used: 3 };
  if (w === 'an' && /^hours?$/.test(lower(words[i + 1] ?? ''))) return { minutes: 60, used: 2 };
  return null;
}

// A span "9-10", "9:00-10:30", "2-3pm", "9 to 10", "9am-5pm".
function spanFrom(words, i) {
  let m = /^(\d{1,2}(?::\d{2})?(?:am|pm)?)[-–](\d{1,2}(?::\d{2})?(?:am|pm)?)$/.exec(lower(words[i]));
  let used = 1;
  if (!m && /^(\d{1,2}(?::\d{2})?(?:am|pm)?)$/.test(lower(words[i])) && lower(words[i + 1] ?? '') === 'to' && /^\d{1,2}(?::\d{2})?(?:am|pm)?$/.test(lower(words[i + 2] ?? ''))) {
    m = [null, lower(words[i]), lower(words[i + 2])];
    used = 3;
  }
  if (!m) return null;
  const endSuffix = /(am|pm)$/.exec(m[2])?.[1];
  const startSuffix = /(am|pm)$/.exec(m[1])?.[1];
  // "2-3pm": the start takes the end's pm unless that would put it after the end.
  let start = timeFrom(!startSuffix && endSuffix ? `${m[1]}${endSuffix}` : m[1], { bare: true });
  const end = timeFrom(m[2], { bare: true });
  if (!start || !end) return null;
  if (!startSuffix && endSuffix && start.minutes >= end.minutes) start = timeFrom(m[1], { bare: true });
  if (end.minutes <= start.minutes) return null;
  return { start: start.minutes, end: end.minutes, used };
}

const stamp = (day, minutes) => {
  const d = atNoon(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const timeText = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export function readEvent(sentence, { today, names = [] } = {}) {
  const words = String(sentence ?? '').trim().split(/\s+/).filter(Boolean);
  const used = new Set();
  const take = (i, n = 1) => { for (let k = 0; k < n; k += 1) used.add(i + k); };
  let day = null;
  let start = null;
  let end = null;
  let minutes = null;

  for (let i = 0; i < words.length; i += 1) {
    if (used.has(i)) continue;
    const w = lower(words[i]);
    const next = lower(words[i + 1] ?? '');
    // Day
    if (!day) {
      if (w === 'today') { day = today; take(i); continue; }
      if (w === 'tomorrow' || w === 'tmr' || w === 'tmrw') { day = plusDays(today, 1); take(i); continue; }
      if ((w === 'next' || w === 'this') && has(DAYS, next)) { day = weekdayOn(today, DAYS[next], { after: w === 'next' }); take(i, 2); continue; }
      if (has(DAYS, w)) { day = weekdayOn(today, DAYS[w]); take(i); continue; }
      if (/^\d{4}-\d{2}-\d{2}$/.test(w) && validDay(Number(w.slice(0, 4)), Number(w.slice(5, 7)), Number(w.slice(8, 10)))) { day = w; take(i); continue; }
      if (has(MONTHS, w) && /^\d{1,2}(st|nd|rd|th)?$/.test(next)) { const d = nextDate(today, MONTHS[w], parseInt(next, 10)); if (d) { day = d; take(i, 2); continue; } }
      if (/^\d{1,2}(st|nd|rd|th)?$/.test(w) && has(MONTHS, next)) { const d = nextDate(today, MONTHS[next], parseInt(w, 10)); if (d) { day = d; take(i, 2); continue; } }
      if (w === 'in' && /^\d+$/.test(next) && /^(day|days|week|weeks)$/.test(lower(words[i + 2] ?? ''))) { day = plusDays(today, Number(next) * (lower(words[i + 2]).startsWith('week') ? 7 : 1)); take(i, 3); continue; }
    }
    // A span of time, then a time, then a length
    if (start === null) {
      const span = spanFrom(words, i);
      if (span) { start = span.start; end = span.end; take(i, span.used); continue; }
      const time = timeFrom(words[i], { bare: lower(words[i - 1] ?? '') === 'at' });
      if (time && !(minutes === null && lengthFrom(words, i))) { start = time.minutes; take(i); continue; }
    }
    if (minutes === null && end === null) {
      const length = lengthFrom(words, i);
      if (length) { minutes = length.minutes; take(i, length.used); continue; }
    }
  }
  // The little words that led to what was found go with it: "at 12:30", "on thu", "for 1h", "from 9-10".
  const goes = { at: (k) => start !== null && used.has(k + 1), on: (k) => day !== null && used.has(k + 1), for: (k) => minutes !== null && used.has(k + 1), from: (k) => start !== null && used.has(k + 1) };
  words.forEach((word, k) => { if (!used.has(k) && has(goes, lower(word)) && goes[lower(word)](k)) used.add(k); });
  // A word like "at" left dangling at the end of the title goes too.
  const kept = words.map((w, k) => ({ w, k })).filter(({ k }) => !used.has(k));
  while (kept.length && /^(at|on|for|from|by|to|until)$/.test(lower(kept[kept.length - 1].w))) kept.pop();

  const title = kept.map(({ w }) => w).join(' ');
  const when = day ?? today;
  const startMinutes = start ?? 9 * 60;
  const length = end !== null ? end - startMinutes : minutes ?? DEFAULT_MINUTES;
  const endMinutes = startMinutes + length;

  // The people the app knows by name: the whole name, or a first name nobody else shares. They stay in the title.
  const found = [];
  const tokens = words.map(lower);
  for (const person of names) {
    const parts = person.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const whole = tokens.some((_, i) => parts.every((p, j) => tokens[i + j] === p));
    const first = parts.length > 1 && tokens.includes(parts[0]) && names.filter((n) => n.name.toLowerCase().split(/\s+/)[0] === parts[0]).length === 1;
    const only = parts.length === 1 && tokens.includes(parts[0]);
    if ((whole || first || only) && !found.some((f) => f.id === person.id)) found.push({ id: person.id, name: person.name });
  }

  return {
    title, day: when, start: timeText(startMinutes), minutes: length, end: timeText(endMinutes % (24 * 60)), people: found,
    found: { day: day !== null, time: start !== null, length: end !== null || minutes !== null },
    starts_at: stamp(when, startMinutes), ends_at: stamp(when, endMinutes),
  };
}
