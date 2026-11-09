// A task's due date (tasks/1): the words typed after @ in a task line, made into a day,
// and the day shown on its chip. A due date is a date, not a plan: it never puts the
// task on a calendar. Days are YYYY-MM-DD in the owner's own time zone; "someday" is a
// due of its own (no day, but not waiting for one either).
// And the Tasks app's add bar (tasks/2): one line the way you would say it, read into a
// day, a time (a reminder), an estimate (~10m), a repeat (every monday) and a flag
// (!must, !like); every other word stays in the title. The server uses the same rules.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export const dayOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const todayDay = () => dayOf(new Date());
const dateOf = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const shift = (day, n) => { const date = dateOf(day); date.setDate(date.getDate() + n); return dayOf(date); };

// The next such weekday, today included.
const nextWeekday = (today, weekday) => shift(today, (weekday - dateOf(today).getDay() + 7) % 7);

// A day of a month: this year's, or next year's once this year's has passed.
function monthDay(today, month, day, year) {
  const date = new Date(year ?? dateOf(today).getFullYear(), month, day);
  if (date.getMonth() !== month) return null; // 31 feb
  if (year === undefined && dayOf(date) < today) date.setFullYear(date.getFullYear() + 1);
  return dayOf(date);
}

const monthOf = (word) => (word.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(word)) : -1);

// Exactly a date: "today", "tomorrow", "friday" or "fri", "12 oct", "oct 12", "12 october
// 2027", "2026-10-30". Anything else is not (null).
export function parseDue(words, today = todayDay()) {
  const text = words.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text === 'someday') return 'someday';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dayOf(dateOf(text)) === text ? text : null;
  if (text === 'today') return today;
  if (text === 'tomorrow') return shift(today, 1);
  const weekday = WEEKDAYS.findIndex((w) => w === text || (text.length === 3 && w.startsWith(text)));
  if (weekday >= 0) return nextWeekday(today, weekday);
  let match = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(text);
  if (match && monthOf(match[2]) >= 0) return monthDay(today, monthOf(match[2]), Number(match[1]), match[3] && Number(match[3]));
  match = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(text);
  if (match && monthOf(match[1]) >= 0) return monthDay(today, monthOf(match[1]), Number(match[2]), match[3] && Number(match[3]));
  return null;
}

// Dates to offer while typing after @: what the words could still become. With nothing
// typed yet, Today and Tomorrow.
export function dueChoices(words, today = todayDay()) {
  const text = words.trim().toLowerCase();
  const exact = parseDue(text, today);
  if (exact) return [{ day: exact, label: dueName(text, exact, today) }];
  const named = ['today', 'tomorrow', ...WEEKDAYS.map((_, i) => WEEKDAYS[(dateOf(today).getDay() + 1 + i) % 7]), 'someday'];
  return named.filter((word) => word.startsWith(text)).slice(0, 3)
    .map((word) => ({ day: parseDue(word, today), label: word[0].toUpperCase() + word.slice(1) }));
}

const dueName = (text, day, today) => (/^[a-z]+$/.test(text) && text.length > 3
  ? text[0].toUpperCase() + text.slice(1) : dueLabel(day, today));

// What a due date's chip says: Today, Tomorrow, Yesterday, or Fri, Oct 30 (with the year
// when it is another year).
export function dueLabel(day, today = todayDay()) {
  if (day === 'someday') return 'Someday';
  if (day === today) return 'Today';
  if (day === shift(today, 1)) return 'Tomorrow';
  if (day === shift(today, -1)) return 'Yesterday';
  const date = dateOf(day);
  return date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', ...(date.getFullYear() === dateOf(today).getFullYear() ? {} : { year: 'numeric' }),
  });
}

// The month and day, beside a choice in a menu: Oct 30.
export const dueMonthDay = (day) => (day === 'someday' ? 'no day yet'
  : dateOf(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

export const addDays = shift;
// The Monday of the week a day is in (a Weekly Goal's week).
export const weekOf = (day) => shift(day, -((dateOf(day).getDay() + 6) % 7));

// ---- Estimates, times and repeats (tasks/2) ----

// ~10m, ~45min, ~1h, ~1h30, ~1.5h: minutes, or null.
export function parseEstimate(word) {
  const match = /^~(?:(\d+(?:\.\d+)?)h(?:(\d{1,2})m?)?|(\d+)(?:m|min)?)$/i.exec(word);
  if (!match) return null;
  const minutes = match[3] ? Number(match[3]) : Math.round(Number(match[1]) * 60) + Number(match[2] ?? 0);
  return minutes > 0 ? minutes : null;
}
export const SPEEDY_MAX = 15;        // minutes: fifteen or less is a Speedy; a longer one is a Task (up to about three hours)
export const SPLIT_OVER = 180;       // minutes: longer is worth splitting (only a hint)
// What an estimate makes a task: the kind is worked out from the minutes, never kept as a second fact.
export const isSpeedy = (minutes) => Number.isInteger(minutes) && minutes > 0 && minutes <= SPEEDY_MAX;
export const taskKind = (minutes) => (!Number.isInteger(minutes) || minutes <= 0 ? null : isSpeedy(minutes) ? 'speedy' : 'task');
export const estimateLabel = (minutes) => (minutes < 60 ? `${minutes} min`
  : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`);

// 2pm, 2:30pm, 9am, 14:00: HH:MM, or null.
export function parseTime(word) {
  let match = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(word);
  if (match) {
    let hour = Number(match[1]);
    if (hour < 1 || hour > 12 || Number(match[2] ?? 0) > 59) return null;
    if (match[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (match[3].toLowerCase() === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${match[2] ?? '00'}`;
  }
  match = /^(\d{1,2}):(\d{2})$/.exec(word);
  if (match && Number(match[1]) < 24 && Number(match[2]) < 60) return `${match[1].padStart(2, '0')}:${match[2]}`;
  return null;
}
export const timeLabel = (time) => new Date(`2000-01-01T${time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// Repeats: "every day", "every weekday", "every week", "every 2 weeks", "every month",
// "every 3 days", "every monday". Kept as these words, made lower case and tidy.
const UNITS = { day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month' };
export function parseRepeat(words) {
  const text = words.trim().toLowerCase().replace(/\s+/g, ' ');
  let match = /^every (day|weekday|week|month)$/.exec(text);
  if (match) return `every ${match[1]}`;
  match = /^every (\d{1,2}) (days?|weeks?|months?)$/.exec(text);
  if (match && Number(match[1]) > 0) return Number(match[1]) === 1 ? `every ${UNITS[match[2]]}` : `every ${Number(match[1])} ${UNITS[match[2]]}s`;
  match = /^every ([a-z]+)$/.exec(text);
  const weekday = match ? WEEKDAYS.findIndex((w) => w === match[1] || (match[1].length === 3 && w.startsWith(match[1]))) : -1;
  return weekday >= 0 ? `every ${WEEKDAYS[weekday]}` : null;
}

// The rule as a chip says it: Every Monday, Every 2 weeks.
export const repeatLabel = (rule) => (rule ? rule[0].toUpperCase() + rule.slice(1) : '');

// The next day a repeat falls on, after `day` (with `included`, `day` itself counts).
export function nextRepeat(repeat, day, { included = false } = {}) {
  const from = included ? shift(day, -1) : day;
  const weekday = WEEKDAYS.findIndex((w) => repeat === `every ${w}`);
  if (weekday >= 0) return nextWeekday(shift(from, 1), weekday);
  if (repeat === 'every weekday') {
    let next = shift(from, 1);
    while ([0, 6].includes(dateOf(next).getDay())) next = shift(next, 1);
    return next;
  }
  const [, n = '1', unit] = /^every (?:(\d+) )?(day|week|month)s?$/.exec(repeat) ?? [];
  if (!unit) return null;
  if (included) return day;
  if (unit === 'day') return shift(day, Number(n));
  if (unit === 'week') return shift(day, 7 * Number(n));
  const date = dateOf(day);
  const target = new Date(date.getFullYear(), date.getMonth() + Number(n), date.getDate());
  if (target.getDate() !== date.getDate()) target.setDate(0); // 31 jan + 1 month: 28/29 feb
  return dayOf(target);
}

// One line read the way you would say it. Each kind is read once, where it first
// appears; every other word stays in the title, so nothing typed is lost.
export function parseQuickAdd(line, today = todayDay()) {
  const words = line.split(/\s+/).filter(Boolean);
  const found = { due: '', time: '', estimate: null, repeat: '', flag: '', goal: false };
  const used = new Set();
  const take = (from, count, kind, value) => {
    if (found[kind] || value === null) return false;
    found[kind] = value;
    for (let i = from; i < from + count; i++) used.add(i);
    return true;
  };
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    const word = words[i].toLowerCase();
    if (word === '!must' || word === '!like') { take(i, 1, 'flag', word.slice(1)); continue; }
    if (word === '*' && !found.goal) { found.goal = true; used.add(i); continue; } // a Weekly Goal
    if (word === 'every') {
      for (const count of [3, 2]) {
        const repeat = i + count <= words.length ? parseRepeat(words.slice(i, i + count).join(' ')) : null;
        if (repeat && take(i, count, 'repeat', repeat)) break;
      }
      continue;
    }
    if (take(i, 1, 'estimate', parseEstimate(word))) continue;
    if (take(i, 1, 'time', parseTime(word))) continue;
    // A date of two or three words (14 oct, oct 14, 14 oct 2027), or of one.
    if (!found.due) {
      for (const count of [3, 2, 1]) {
        const phrase = i + count <= words.length ? words.slice(i, i + count).join(' ') : null;
        const due = phrase && (count > 1 || !/^\d+$/.test(word)) ? parseDue(phrase, today) : null;
        if (due && take(i, count, 'due', due)) break;
      }
    }
  }
  const title = words.filter((_, i) => !used.has(i)).join(' ');
  // A repeat with no day starts on its first day, today included.
  if (found.repeat && !found.due) found.due = nextRepeat(found.repeat, today, { included: true });
  return { title, ...found };
}
