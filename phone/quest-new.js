// The new Sovran Quest on go Sovran (2026-11-28, the owner's phone design, sketch version 26 in the course-lessons
// project files, and his answers on the Quest Build Plan). Shown to Daniel first, as a preview on his own go Sovran;
// students keep the Quest they have (quest.js) until he says it is really ready.
//
// The screens (each says where you are, and each block what it is):
//   0  Sovran Quest      the weeks that have opened (never one ahead), and Group Calls
//   1  a week            Week capsule, "WEEK 2 MISSIONS", its name, and three tabs on deep violet:
//                        Lessons (its films), Every day (the practice boxes, Monday to Friday), This week (homework)
//   2  a lesson          the film, "Carry on from 18:20", its chapters
//   8  Group Calls       every call (tap one for its page: summary, replay, transcript, Ask), the next call at the foot,
//                        and the red box from 15 minutes before the call until it ends
//   11 How to do it      a practice's film or audio, then "Complete it", back to where the student came from
//
// What is kept where:
//   the weeks          the Sovran cloud's Quest shelf, with the phone's own Group Circle key; only weeks that have opened
//                      are ever there (APP Daniel sends each when it opens)
//   films watched      this phone (where each film was left, how far it was watched)
//   practice ticks     this phone, for now (the summary for Daniel comes with its own step)
//   homework Done      as before: a sealed note to the student's computer, and the computer's word back on the shelf

import { richText, plainText, transcriptLines, standing, weekKey } from './quest.js';

const $ = (id) => document.getElementById(id);
const WEEKS = 'sovran.phone.quest-weeks';
const PENDING = 'sovran.phone.quest-pending';
const FILMS = 'sovran.phone.qn-films';   // { filmId: { at, max, done } } and last: { week, film }
const TICKS = 'sovran.phone.qn-ticks';   // { weekKey: { day: { practiceId: count } } }
const TRIED = 'sovran.phone.qn-tried';   // Daniel's own Done while he tries the screens: { 'SQ01-2#1': true }, never sent
const HLS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL = ['', 'once', 'twice', 'three times', 'four times', 'five times'];
// The colour and label of each kind of homework (the owner's choice, 28 Nov: a stripe on the left and a bold label).
const KINDS = { journal: { label: 'JOURNAL', colour: '#ffe500' }, report: { label: 'SOVRAN PATTERN REPORT', colour: '#d9c14b' }, advisor: { label: 'SOVRAN ADVISOR', colour: '#a98be0' } };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}
const svg = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };
const calendarIcon = () => svg('<svg class="qn-cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>');
const safeUrl = (url) => (/^https:\/\/[^\s]+$/i.test(String(url ?? '')) ? url : '');
const two = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const dateOf = (day) => new Date(`${day}T12:00`);
const addDays = (day, n) => { const d = dateOf(day); d.setDate(d.getDate() + n); return localDay(d); };
const clock = (s) => { const t = Math.max(0, Math.round(Number(s) || 0)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); return h ? `${h}:${two(m)}:${two(t % 60)}` : `${m}:${two(t % 60)}`; };
const minutes = (s) => { const m = Math.round((Number(s) || 0) / 60); return m < 1 ? 'Under a minute' : `${m} min`; };
const longDay = (day) => dateOf(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const hourWords = (date) => { const h = date.getHours(); const m = date.getMinutes(); return `${h % 12 || 12}${m ? `:${two(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const titleCase = (s) => String(s ?? '').toUpperCase();
const pictureSrc = (key) => (key ? `brand/quest/${key}.png` : '');
const filmSrc = (f) => `https://stream.mux.com/${encodeURIComponent(f.playback_id)}.m3u8?token=${encodeURIComponent(f.token)}`;
const thumbSrc = (f) => (f?.playback_id && f.thumb ? `https://image.mux.com/${encodeURIComponent(f.playback_id)}/thumbnail.jpg?token=${encodeURIComponent(f.thumb)}` : '');

// ---- Time in the group's place (the call is "Monday, 6 PM" in Athens; a student elsewhere sees their own time) ----
function offsetAt(ms, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  } catch { return 0; }
}
function zoned(day, hhmm, tz) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, m] = String(hhmm).split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, m);
  let at = wall;
  for (let i = 0; i < 3; i += 1) at = wall - offsetAt(at, tz);
  return at;
}
// The group's calls around now: the one going on or the next. → { start: Date } or null
export function callAround(call, now = Date.now()) {
  if (!call || !Number.isInteger(call.weekday) || !/^\d{1,2}:\d{2}$/.test(call.time ?? '')) return null;
  const tz = call.tz || 'Europe/Athens';
  for (let back = 1; back >= -8; back -= 1) {
    // Days around today in the group's place, oldest first; the first call that hasn't ended is the one.
    const day = new Date(now - back * 86_400_000 + offsetAt(now, tz)).toISOString().slice(0, 10);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() !== call.weekday) continue;
    const start = zoned(day, call.time, tz);
    if (start + 90 * 60_000 > now) return { start: new Date(start) };
  }
  return null;
}
// The red box (the owner, 28 Nov): from 15 minutes before the call until it ends (an hour and a half).
export function liveState(call, now = Date.now()) {
  const next = callAround(call, now);
  if (!next) return null;
  const until = next.start.getTime() - now;
  if (until > 15 * 60_000) return { kind: 'later', start: next.start };
  if (until > 0) return { kind: 'soon', start: next.start, minutes: Math.max(1, Math.ceil(until / 60_000)) };
  return { kind: 'live', start: next.start };
}

// ---- Sample weeks, for Daniel's preview before the real weeks have films and practices ----
function sampleWeeks() {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const day = (n) => { const d = new Date(monday); d.setDate(d.getDate() + n); return localDay(d); };
  const call = { weekday: 1, day: 'Monday', time: '18:00', tz: 'Europe/Athens', meet_url: 'https://meet.google.com/' };
  const film = (id, title, duration, chapters = []) => ({ id, title, duration, chapters: chapters.length ? chapters : [{ at: 0, title: 'Start' }], sample: true });
  return [
    { group: 'SAMPLE', number: 0, title: 'Welcome to the Quest', call_on: day(-14), call, summary: 'We met each other and looked at what the Quest asks of us.', replay_url: '', films: [], practices: [], homework: [] },
    { group: 'SAMPLE', number: 1, title: 'The War Inside', call_on: day(-7), call, summary: 'The war inside, and how the STOP Training begins.', replay_url: '', films: [], homework: [],
      practices: [{ id: 'sp1', name: 'STOP Training', how: '', per_day: 3, picture: 'stop', colour: '#C71F42' }] },
    {
      group: 'SAMPLE', number: 2, title: 'Meeting the Tyrant', call_on: day(0), call,
      summary: 'Daniel introduced the Tyrant: where it comes from, how it sounds inside you, and how to meet it with STOP.', replay_url: '',
      films: [film('s1', 'Welcome to Week 2', 360), film('s2', 'Meeting the Tyrant', 2520, [{ at: 0, title: 'The War Inside' }, { at: 360, title: 'Where the Tyrant Comes From' }, { at: 780, title: 'How It Sounds in You' }, { at: 1320, title: 'Wholeness Was Never Lost' }, { at: 1770, title: 'Meeting It with STOP' }, { at: 2160, title: 'This Week’s Practice' }]),
        film('s3', 'The STOP Training, Step by Step', 720, [{ at: 0, title: 'Stop' }, { at: 240, title: 'Turn inward' }, { at: 480, title: 'Open' }])],
      practices: [{ id: 'sp1', name: 'STOP Training', how: 'Five minutes, three times a day.', per_day: 3, picture: 'stop', colour: '#C71F42', how_film: { id: 'sh', title: 'STOP Training with Daniel', duration: 305, sample: true } },
        { id: 'sp2', name: 'Name the Tyrant', how: 'Once a day, give the Tyrant a name when it shows up.', per_day: 1, picture: 'tyrant', colour: '#343038' }],
      homework: [{ text: 'Write in your Journal about one moment the Tyrant showed up this week.', where: 'journal', picture: 'tyrant' },
        { text: 'Read your Sovran Pattern Report. Ask Sovran Advisor about anything you don’t understand.', where: 'report' },
        { text: 'Walk twenty minutes a day, without your phone.', where: 'elsewhere' }],
    },
  ];
}

// store, show, ask, available, isGuide, openShelf, leave, ai, say: as for quest.js (phone.js passes the same).
export function setupQuestNew({ store, show, ask, available, isGuide, openShelf, leave, ai, say }) {
  const read = (key, fallback) => { try { return JSON.parse(store.get(key) ?? '') ?? fallback; } catch { return fallback; } };
  const write = (key, value) => store.set(key, JSON.stringify(value));
  let weeks = [];
  let sample = false;
  let shelf = null;
  let pending = read(PENDING, []);
  let films = read(FILMS, {});
  let ticks = read(TICKS, {});
  let tried = read(TRIED, {});
  let where = { s: 'week' };   // the screen on show
  let dayChosen = null;        // the day picked on Every day
  let player = null;           // the film or audio playing, to stop when leaving
  const transcripts = new Map();
  const guide = () => Boolean(isGuide());
  const keepPending = () => { if (shelf?.at) pending = pending.filter((p) => p.at > shelf.at); write(PENDING, pending.slice(-200)); };

  async function check() {
    shelf = await openShelf('quest').catch(() => null);
    if (shelf && !Array.isArray(shelf.marks)) shelf = null;
    keepPending();
    let list = read(WEEKS, []);
    if (available()) {
      try {
        const answer = await ask({ action: 'quest_weeks' });
        if (Array.isArray(answer.weeks)) {
          list = answer.weeks.filter((w) => w && Number.isInteger(w.number));
          if (guide() && list.length) list = list.filter((w) => w.group === list[0].group);
          list = list.map(({ transcript: _t, ...w }) => w);
        }
      } catch { /* no signal: the weeks read last time */ }
    }
    // Never a week ahead: only what has opened (APP Daniel only sends a week when it opens; this is the second lock).
    weeks = list.filter((w) => !w.opens_at || Date.parse(w.opens_at) <= Date.now()).sort((a, b) => a.number - b.number);
    sample = guide() && !weeks.some((w) => (w.films ?? []).length || (w.practices ?? []).length);
    if (sample) weeks = sampleWeeks();
  }

  const current = () => weeks.at(-1);
  const weekOf = (n) => weeks.find((w) => w.number === n) ?? current();
  const keyOf = (w) => weekKey(w.group, w.number);
  const callOf = () => [...weeks].reverse().find((w) => w.call)?.call ?? null;

  // ---- Progress ----
  const filmState = (f) => films[f.id] ?? { at: 0, max: 0, done: false };
  const watched = (f) => filmState(f).done;
  const weekDays = (w) => [0, 1, 2, 3, 4].map((n) => addDays(w.call_on || localDay(new Date()), n));
  const today = () => localDay(new Date());
  const ticksOn = (w, day, p) => ticks[keyOf(w)]?.[day]?.[p.id] ?? 0;
  const homeworkDone = (w, i) => {
    if (guide() || sample) return Boolean(tried[`${keyOf(w)}#${i + 1}`]);
    return standing(shelf, pending, keyOf(w), i + 1).done;
  };
  function counts(w) {
    const fl = w.films ?? [];
    const days = weekDays(w).filter((d) => d <= today());
    const boxes = days.length * (w.practices ?? []).reduce((n, p) => n + p.per_day, 0);
    const ticked = days.reduce((n, d) => n + (w.practices ?? []).reduce((m, p) => m + Math.min(p.per_day, ticksOn(w, d, p)), 0), 0);
    const hw = w.homework ?? [];
    return {
      lessons: [fl.filter(watched).length, fl.length], daily: [ticked, boxes], homework: [hw.filter((_, i) => homeworkDone(w, i)).length, hw.length],
    };
  }
  const allDone = (c) => c.lessons[0] + c.daily[0] + c.homework[0];
  const allOf = (c) => c.lessons[1] + c.daily[1] + c.homework[1];

  // ---- Moving between screens ----
  function go(next, replace = false) {
    stopPlayer();
    where = next;
    history[replace ? 'replaceState' : 'pushState']({ view: 'qn', ...next }, '');
    render();
  }
  function render(state) {
    if (state) { stopPlayer(); where = state; }
    show('qn');
    document.body.classList.add('in-qn');
    const draw = { home: drawHome, week: drawWeek, lesson: drawLesson, calls: drawCalls, call: drawCall, how: drawHow, transcript: drawTranscript }[where.s] ?? drawWeek;
    $('qn').replaceChildren(...draw());
    scrollTo(0, 0);
  }
  const back = (words) => el('button', { type: 'button', class: 'qn-back', 'aria-label': `Back${words ? ` to ${words}` : ''}`, onclick: () => history.back() }, '‹');
  const top = (...rest) => el('div', { class: 'qn-top' }, ...rest);
  const crumb = (words) => el('span', { class: 'qn-crumb' }, words);
  const capsule = (w) => el('span', { class: 'qn-wk' }, `Week ${w.number}`);
  const callsLink = () => {
    const live = liveState(callOf());
    return el('button', { type: 'button', class: `qn-gc${live && live.kind !== 'later' ? ' qn-gc-live' : ''}`, onclick: () => go({ s: 'calls' }) }, 'Group Calls ›');
  };
  const eyebrow = (words) => el('p', { class: 'qn-eyebrow' }, words);
  const heading = (words, cls = '') => el('h1', { class: `qn-title ${cls}` }, words);
  const part = (label, line) => el('div', { class: 'qn-ph' }, el('b', {}, label), line ? el('span', {}, line) : null);
  const sampleNote = () => (sample ? el('p', { class: 'qn-sample' }, 'Sample content, to try the screens. Your real weeks show here once their films and practices are in.') : null);
  const panel = (...kids) => el('div', { class: 'qn-panel' }, ...kids);

  // ---- 0: Sovran Quest, the weeks ----
  function drawHome() {
    const first = weeks[0];
    const rows = weeks.map((w) => {
      const c = counts(w);
      const now = w === current();
      const done = allOf(c) > 0 && allDone(c) === allOf(c);
      return el('button', { type: 'button', class: `qn-wl${now ? ' qn-now' : ''}`, onclick: () => go({ s: 'week', week: w.number, tab: 'lessons' }) },
        el('span', { class: 'qn-wl-words' }, el('span', { class: 'qn-n' }, `WEEK ${w.number}${now ? ' · THIS WEEK' : ''}`), el('b', {}, w.title || `Week ${w.number}`),
          now && allOf(c) ? el('span', { class: 'qn-mini' }, el('i', { style: { width: `${Math.round((allDone(c) / allOf(c)) * 100)}%` } })) : null),
        el('span', { class: `qn-st${done ? ' qn-ok' : ''}` }, now ? 'Open ›' : done ? '✓ Done' : '›'));
    });
    const call = callOf();
    return [
      top(back('go Sovran'), crumb('go Sovran')),
      heading('Sovran Quest', 'qn-quest'),
      first?.call_on ? eyebrow(`${first.group === 'SAMPLE' ? 'SQ01' : first.group} · FROM ${titleCase(dateOf(first.call_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }))}`) : null,
      sampleNote(),
      panel(
        part('YOUR WEEKS', 'Tap a week to open it.'), ...rows,
        part('GROUP CALLS', 'Replays and transcripts of every call.'),
        el('button', { type: 'button', class: 'qn-wl', onclick: () => go({ s: 'calls' }) },
          el('span', { class: 'qn-wl-words' }, el('b', {}, 'Group Calls'), call ? el('span', { class: 'qn-every' }, everyWords(call)) : null), el('span', { class: 'qn-st' }, '›'))),
    ];
  }
  function everyWords(call) {
    const next = callAround(call);
    if (!next) return '';
    return `EVERY ${DAYS[next.start.getDay()].toUpperCase()}, ${hourWords(next.start)}`;
  }

  // ---- 1: a week, with its three tabs ----
  function drawWeek() {
    const w = weekOf(where.week);
    const tab = where.tab ?? 'lessons';
    const c = counts(w);
    const tabButton = (name, words, [a, b]) => el('button', { type: 'button', role: 'tab', class: 'qn-tab', 'aria-selected': String(tab === name),
      onclick: () => go({ s: 'week', week: w.number, tab: name }, true) }, words, b ? el('small', {}, ` ${a}/${b}`) : null);
    const body = { lessons: lessonsTab, daily: dailyTab, homework: homeworkTab }[tab](w);
    return [
      top(back('Sovran Quest'), capsule(w), callsLink()),
      eyebrow(`WEEK ${w.number} MISSIONS`), heading(w.title || `Week ${w.number}`),
      allOf(c) ? el('div', { class: 'qn-prog' }, el('span', { class: 'qn-bar' }, el('i', { style: { width: `${Math.round((allDone(c) / allOf(c)) * 100)}%` } })), `${allDone(c)} of ${allOf(c)} done`) : null,
      sampleNote(),
      el('div', { class: 'qn-tabs', role: 'tablist' }, tabButton('lessons', 'Lessons', c.lessons), tabButton('daily', 'Every day', c.daily), tabButton('homework', 'This week', c.homework)),
      el('div', { class: 'qn-panel qn-under-tabs', role: 'tabpanel' }, ...body),
    ];
  }

  // Lessons: where you left off, then the week's films in order.
  function lessonsTab(w) {
    const list = w.films ?? [];
    if (!list.length) return [part('THE LESSONS', `The films for Week ${w.number} come here.`)];
    const out = [];
    const last = films.last && films.last.week === keyOf(w) ? list.find((f) => f.id === films.last.film) : null;
    const ls = last ? filmState(last) : null;
    if (last && ls.at > 5 && !ls.done) {
      const n = list.indexOf(last) + 1;
      const ch = chapterAt(last, ls.at);
      out.push(part('PICK UP WHERE YOU LEFT OFF'),
        el('button', { type: 'button', class: 'qn-cont', onclick: () => go({ s: 'lesson', week: w.number, film: last.id, resume: true }) },
          el('span', { class: 'qn-pl', 'aria-hidden': 'true' }, '▶'),
          el('span', {}, el('b', {}, 'Continue where you left off'), el('small', {}, `Lesson ${n}${ch ? ` · Chapter ${ch.n}` : ''} · at ${clock(ls.at)}`))));
    }
    out.push(part(`THE LESSONS FOR WEEK ${w.number}`, 'Watch them in order. Long films are in chapters.'));
    list.forEach((f, i) => {
      const s = filmState(f);
      const chapters = (f.chapters ?? []).length > 1 ? ` · ${f.chapters.length} chapters` : '';
      const thumb = thumbSrc(f);
      out.push(el('button', { type: 'button', class: 'qn-film', onclick: () => go({ s: 'lesson', week: w.number, film: f.id }) },
        el('span', { class: 'qn-thumb', style: thumb ? { backgroundImage: `url("${thumb}")` } : null }, el('span', { class: 'qn-thumb-n' }, String(i + 1)), el('span', { 'aria-hidden': 'true' }, '▶')),
        el('span', { class: 'qn-film-words' }, el('b', {}, f.title), el('small', {}, `${minutes(f.duration)}${chapters}`),
          s.done ? el('span', { class: 'qn-ok' }, '✓ Watched') : s.max > 0 ? el('span', { class: 'qn-mini' }, el('i', { style: { width: `${Math.min(100, Math.round((s.max / (f.duration || 1)) * 100))}%` } })) : null)));
    });
    return out;
  }
  function chapterAt(f, at) {
    const list = f.chapters ?? [];
    let found = null;
    list.forEach((c, i) => { if (c.at <= at) found = { ...c, n: i + 1 }; });
    return found;
  }

  // Every day: pick a day, then tick each time. Earlier days of the week can be ticked; days to come can't.
  function dailyTab(w) {
    const practices = w.practices ?? [];
    if (!practices.length) return [part('THE DAILY PRACTICE', `This week’s practice comes here.`)];
    const days = weekDays(w);
    const now = today();
    if (!dayChosen || !days.includes(dayChosen)) dayChosen = days.includes(now) ? now : days.filter((d) => d <= now).at(-1) ?? days[0];
    const before = weeks.find((x) => x.number === w.number - 1);
    const isNew = (p) => before && !(before.practices ?? []).some((q) => q.name === p.name);
    const chips = days.map((d) => {
      const dots = practices.flatMap((p) => Array.from({ length: p.per_day }, (_, i) => el('i', { style: i < ticksOn(w, d, p) ? { background: p.colour || '#059e30' } : null })));
      return el('button', { type: 'button', class: 'qn-d', 'aria-pressed': String(d === dayChosen), disabled: d > now ? true : null,
        onclick: () => { dayChosen = d; render(); } }, DAYS[dateOf(d).getDay()].slice(0, 3), el('span', { class: 'qn-dots' }, ...dots));
    });
    const key = el('div', { class: 'qn-key' }, ...practices.map((p) => el('span', {}, el('i', { style: { background: p.colour || '#fbfbfb' } }), p.name)));
    const rows = practices.map((p) => {
      const n = ticksOn(w, dayChosen, p);
      const rings = Array.from({ length: p.per_day }, (_, i) => el('button', { type: 'button', class: 'qn-ring', 'aria-pressed': String(i < n), 'aria-label': `${p.name}: time ${i + 1}${i < n ? ', done' : ''}`,
        onclick: () => tick(w, dayChosen, p, i + 1 <= n ? i : i + 1) }, i < n ? '✓' : p.per_day > 1 ? String(i + 1) : ''));
      const how = p.how_film ? el('button', { type: 'button', class: 'qn-how', onclick: () => go({ s: 'how', week: w.number, practice: p.id, tab: 'daily' }) }, 'How to do it ›') : null;
      return el('div', { class: 'qn-prac', style: { '--k': p.colour || '#fbfbfb' } },
        p.picture ? el('img', { class: p.picture === 'stop' ? 'qn-ico' : 'qn-fig', src: pictureSrc(p.picture), alt: '' }) : null,
        el('div', { class: 'qn-prac-words' }, el('span', { class: 'qn-kl' }, titleCase(p.name)),
          el('span', { class: 'qn-sub' }, practiceLine(p, true), isNew(p) ? el('span', { class: 'qn-new' }, 'New this week') : null), how),
        el('div', { class: 'qn-rings' }, ...rings));
    });
    return [
      part('THE DAILY PRACTICE, MONDAY TO FRIDAY', 'Pick a day, then tick each time you do it.'),
      el('div', { class: 'qn-days' }, ...chips), key,
      el('p', { class: 'qn-dayname' }, titleCase(DAYS[dateOf(dayChosen).getDay()])),
      ...rows,
      el('p', { class: 'qn-foot' }, guide() ? 'Your ticks stay on this phone.' : 'Your ticks stay on this phone. Only you see them.'),
    ];
  }
  function practiceLine(p, today) {
    const mins = p.how_film?.duration ? `${Math.round(p.how_film.duration / 60)} minutes, ` : '';
    if (p.per_day === 1) return today ? 'Once today' : 'Once a day';
    return `${mins}${ORDINAL[p.per_day] ?? `${p.per_day} times`}${today ? '' : ' a day'}`.replace(/^./, (c) => c.toUpperCase());
  }
  function tick(w, day, p, count) {
    if (day > today()) return;
    const k = keyOf(w);
    ticks[k] ??= {}; ticks[k][day] ??= {};
    ticks[k][day][p.id] = Math.max(0, Math.min(p.per_day, count));
    write(TICKS, ticks);
    render();
  }

  // This week: the homework, each card in the colour of what it uses, with the character it is about.
  function homeworkTab(w) {
    const hw = w.homework ?? [];
    const call = w.call ?? callOf();
    const next = call ? DAYS[call.weekday] : 'Monday';
    if (!hw.length) return [part('TO DO THIS WEEK', `Your homework comes after ${next}’s call.`)];
    return [
      part('TO DO THIS WEEK', `Any time before ${next}’s call.`),
      ...hw.map((h, i) => {
        const kind = KINDS[h.where];
        const done = homeworkDone(w, i);
        const pic = h.where === 'report' ? 'pattern' : h.picture;
        return el('div', { class: `qn-card${kind ? ' qn-kind' : ''}${pic ? ' qn-has-fig' : ''}`, style: kind ? { '--k': kind.colour } : null },
          el('span', { class: 'qn-num' }, String(i + 1)),
          el('div', { class: 'qn-card-words' }, kind ? el('span', { class: 'qn-kindl' }, kind.label) : null, el('div', { class: 'qn-rich' }, ...richText(h.text)),
            el('button', { type: 'button', class: 'qn-tk', 'aria-pressed': String(done), onclick: () => doneHomework(w, i + 1, !done) }, el('i', {}, done ? '✓' : ''), 'Done')),
          pic ? el('img', { class: 'qn-stand', src: pictureSrc(pic), alt: '' }) : null);
      }),
    ];
  }
  function doneHomework(w, piece, on) {
    const at = new Date().toISOString();
    if (guide() || sample) { tried[`${keyOf(w)}#${piece}`] = on; write(TRIED, tried); } else {
      pending.push({ week: keyOf(w), piece, done: on, at });
      keepPending();
      leave({ kind: 'quest_done', group: w.group, number: w.number, piece, on, at });
    }
    render();
  }

  // ---- 2: a lesson ----
  function drawLesson() {
    const w = weekOf(where.week);
    const list = w.films ?? [];
    const f = list.find((x) => x.id === where.film) ?? list[0];
    if (!f) return drawWeek();
    const s = filmState(f);
    const n = list.indexOf(f) + 1;
    const video = el('video', { class: 'qn-video', controls: true, playsinline: true, preload: 'metadata', poster: thumbSrc(f) || null });
    const chapters = el('div', { class: 'qn-chapters' });
    const drawChapters = (at) => {
      const list2 = f.chapters ?? [];
      chapters.replaceChildren(...list2.map((c, i) => {
        const end = list2[i + 1]?.at ?? f.duration;
        const playing = at >= c.at && at < end && !video.paused;
        const seen = filmState(f).max >= end - 2 || filmState(f).done;
        return el('button', { type: 'button', class: `qn-ch${playing ? ' qn-ch-now' : ''}`, onclick: () => { seek(c.at); } },
          el('span', { class: 't' }, clock(c.at)), el('span', { class: 'qn-ch-name' }, c.title), playing ? el('span', { class: 's' }, 'Playing') : seen ? el('span', { class: 's qn-ok' }, '✓') : null);
      }));
    };
    const seek = (at) => { if (f.sample) { say('Sample film: your own films play here.'); return; } video.currentTime = at; video.play().catch(() => {}); };
    const box = el('div', { class: 'qn-videobox' }, f.sample ? el('div', { class: 'qn-video qn-video-sample' }, el('span', {}, '▶'), el('small', {}, 'Your films play here')) : video);
    if (!f.sample && f.playback_id) {
      player = attach(video, f, {
        start: where.resume ? s.at : 0,
        progress: (at, duration) => {
          const st = filmState(f);
          films[f.id] = { at, max: Math.max(st.max, at), done: st.done || (duration > 0 && at >= duration - 15) };
          films.last = { week: keyOf(w), film: f.id };
          write(FILMS, films);
          drawChapters(at);
        },
      });
    }
    const resume = s.at > 5 && !s.done ? el('button', { type: 'button', class: 'qn-resume', onclick: () => seek(s.at) }, el('i', { 'aria-hidden': 'true' }, '▶'), `Carry on from ${clock(s.at)}`) : null;
    drawChapters(-1);
    return [
      top(back(`Week ${w.number}`), capsule(w)),
      eyebrow(`LESSON ${n} OF ${list.length}`), heading(f.title),
      el('div', { class: 'qn-panel qn-flat' }, box, resume,
        (f.chapters ?? []).length > 1 ? part('THE CHAPTERS OF THIS LESSON', 'Tap one to jump to it. ✓ means watched.') : null,
        (f.chapters ?? []).length > 1 ? chapters : null),
    ];
  }

  // A signed Mux film in a video element: Safari plays it as it is, other browsers through hls.js (loaded only then).
  function attach(video, f, { start = 0, progress }) {
    let hls = null;
    let last = 0;
    const src = filmSrc(f);
    const begin = () => { if (start > 0) { try { video.currentTime = start; } catch { /* set once it can be */ } } };
    video.addEventListener('loadedmetadata', begin, { once: true });
    video.addEventListener('timeupdate', () => { const now = Date.now(); if (now - last > 4000) { last = now; progress(video.currentTime, video.duration || f.duration); } });
    for (const e of ['pause', 'ended', 'seeked', 'play']) video.addEventListener(e, () => progress(video.currentTime, video.duration || f.duration));
    if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = src;
    else {
      loadHls().then((Hls) => {
        if (!Hls?.isSupported()) { video.src = src; return; }
        hls = new Hls(); hls.loadSource(src); hls.attachMedia(video);
      }).catch(() => { video.src = src; });
    }
    return { video, stop() { try { video.pause(); } catch { /* gone */ } hls?.destroy(); } };
  }
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HLS; s.onload = () => resolve(window.Hls); s.onerror = reject;
      document.head.append(s);
    });
  }
  function stopPlayer() { player?.stop(); player = null; }

  // ---- 11: How to do it ----
  function drawHow() {
    const w = weekOf(where.week);
    const p = (w.practices ?? []).find((x) => x.id === where.practice);
    if (!p?.how_film) return drawWeek();
    const f = p.how_film;
    const audio = el('video', { class: 'qn-hidden-video', playsinline: true, preload: 'metadata' });
    const line = el('span', { class: 'qn-ln' }, el('i'));
    const at = el('span', {}, '0:00');
    const play = el('button', { type: 'button', class: 'qn-pb', 'aria-label': 'Play' }, '▶');
    const length = el('span', {}, clock(f.duration));
    if (!f.sample && f.playback_id) {
      player = attach(audio, f, { progress: () => {} });
      audio.addEventListener('timeupdate', () => {
        at.textContent = clock(audio.currentTime);
        line.firstChild.style.width = `${Math.min(100, (audio.currentTime / (audio.duration || f.duration || 1)) * 100)}%`;
      });
      audio.addEventListener('play', () => { play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pause'); });
      audio.addEventListener('pause', () => { play.textContent = '▶'; play.setAttribute('aria-label', 'Play'); });
      play.addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
      line.addEventListener('click', (e) => { const r = line.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * (audio.duration || f.duration); });
    } else play.addEventListener('click', () => say('Sample: your STOP Training audio plays here.'));
    return [
      top(back('Every day'), crumb('Sovran Quest · Every day')),
      el('h1', { class: 'qn-stoph' }, p.picture ? el('img', { src: pictureSrc(p.picture), alt: '' }) : null, p.name),
      el('p', { class: 'qn-detail' }, titleCase(practiceLine(p, false))),
      el('div', { class: 'qn-panel qn-flat' },
        part('LISTEN ALONG', 'Daniel leads you through it.'),
        el('div', { class: 'qn-player', style: { '--k': p.colour || '#c71f42' } },
          el('div', { class: 'qn-rowp' }, play, el('div', {}, el('b', {}, f.title), el('small', {}, `Audio · ${clock(f.duration)}`))),
          line, el('div', { class: 'qn-ptm' }, at, length), audio),
        part('COMPLETE YOUR TRAINING SESSION', 'Make sure to mark your practice complete.'),
        el('button', { type: 'button', class: 'qn-backbtn', onclick: () => history.back() }, '‹ Complete it')),
    ];
  }

  // ---- 8: Group Calls ----
  function drawCalls() {
    const call = callOf();
    const live = liveState(call);
    const calls = weeks.filter((w) => w.summary || safeUrl(w.replay_url) || w.has_transcript);
    const out = [];
    if (live && live.kind !== 'later') {
      const name = current()?.title && live.kind === 'live' ? current().title : 'Your group call';
      const meet = safeUrl(call?.meet_url);
      out.push(el('div', { class: 'qn-ph qn-ph-line' }, el('b', {}, live.kind === 'live' ? 'THE CALL IS ON NOW' : 'THE CALL STARTS SOON')),
        el('div', { class: 'qn-joinc' },
          el('small', {}, live.kind === 'live' ? [el('span', { class: 'qn-dot' }), `LIVE NOW · STARTED ${hourWords(live.start)}`] : `COMING UP IN ${live.minutes} ${live.minutes === 1 ? 'MINUTE' : 'MINUTES'} · ${hourWords(live.start)}`),
          el('b', {}, name),
          meet ? el('a', { class: 'qn-meet', href: meet, target: '_blank', rel: 'noopener' }, el('span', { class: 'qn-cam', 'aria-hidden': 'true' }), 'Join on Google Meet') : el('p', { class: 'qn-jn' }, 'The Join link comes here.')));
    }
    out.push(part('THE REPLAYS AND TRANSCRIPTS', 'Tap a call for its summary, replay and transcript.'));
    if (!calls.length) out.push(el('p', { class: 'qn-foot' }, 'The first call shows here after it.'));
    calls.forEach((w, i) => {
      const latest = i === calls.length - 1;
      out.push(el('button', { type: 'button', class: `qn-call${latest ? ' qn-latest' : ''}`, onclick: () => go({ s: 'call', week: w.number }) },
        el('small', {}, `WEEK ${w.number}${w.call_on ? ` · ${titleCase(longDay(w.call_on))}` : ''}`),
        el('b', {}, w.title || `Week ${w.number} call`), latest ? el('span', { class: 'qn-tagl' }, 'Latest') : null, el('span', { class: 'qn-go', 'aria-hidden': 'true' }, '›')));
    });
    if (live?.kind === 'later') {
      out.push(el('div', { class: 'qn-nextq' }, calendarIcon(), el('div', {},
        el('small', {}, `NEXT CALL · WEEK ${(current()?.number ?? -1) + 1}`),
        el('span', {}, `${live.start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${hourWords(live.start)}`),
        el('span', {}, 'Join opens here 15 minutes before, in Google Meet.'))));
    }
    return [top(back('Sovran Quest'), crumb('Sovran Quest')), heading('Group Calls', 'qn-gct'), call ? el('p', { class: 'qn-detail' }, everyWords(call)) : null, sampleNote(),
      el('div', { class: 'qn-panel qn-flat' }, ...out)];
  }

  // One call: its summary, the replay, the transcript, and Ask Sovran Advisor about it.
  function drawCall() {
    const w = weekOf(where.week);
    const replay = safeUrl(w.replay_url);
    const words = `About the Week ${w.number} group call of my Sovran Quest${w.title ? ` (${w.title})` : ''}: `;
    const fills = Boolean(ai.fill);
    return [
      top(back('Group Calls'), crumb('Group Calls')),
      eyebrow(`WEEK ${w.number}${w.call_on ? ` · ${titleCase(longDay(w.call_on))}` : ''}`), heading(w.title || `Week ${w.number} call`),
      el('div', { class: 'qn-panel qn-flat' },
        w.summary ? part('THE SUMMARY') : null, w.summary ? el('div', { class: 'qn-rich qn-summary' }, ...richText(w.summary)) : null,
        part('WATCH OR READ IT'),
        el('div', { class: 'qn-acts' },
          replay ? el('a', { class: 'qn-pill', href: replay, target: '_blank', rel: 'noopener' }, 'Watch the replay ↗') : el('span', { class: 'qn-pill qn-pill-off' }, 'No replay yet'),
          w.has_transcript ? el('button', { type: 'button', class: 'qn-pill', onclick: () => go({ s: 'transcript', week: w.number }) }, 'Read the transcript ›') : null),
        part('ASK ABOUT IT', 'Your Sovran Advisor has read the call.'),
        el('a', { class: 'qn-pill qn-pill-solid', href: fills ? ai.fill + encodeURIComponent(words) : ai.href, target: '_blank', rel: 'noopener',
          onclick: () => { try { navigator.clipboard?.writeText(words).catch(() => {}); } catch { /* the words are still on the page */ } } }, 'Ask my Sovran Advisor ↗')),
    ];
  }

  // The transcript, asked for when it is opened, with search.
  function drawTranscript() {
    const w = weekOf(where.week);
    const k = keyOf(w);
    const lines = el('div', { class: 'qn-lines' }, el('p', { class: 'qn-foot' }, 'Opening the transcript…'));
    const search = el('input', { type: 'search', class: 'qn-search', placeholder: 'Search the call', 'aria-label': 'Search the call', autocomplete: 'off' });
    const found = el('p', { class: 'qn-found', role: 'status' });
    const fill = (list, look) => {
      const want = look.trim().toLowerCase();
      let hits = 0;
      lines.replaceChildren(...(list.length ? list.map((l) => {
        const p = el('p', {}, el('b', {}, l.who || ' ', l.at ? el('span', { class: 'qn-at' }, l.at) : null));
        if (want && l.text.toLowerCase().includes(want)) {
          hits += 1;
          let rest = l.text; let pos;
          while ((pos = rest.toLowerCase().indexOf(want)) >= 0) { p.append(rest.slice(0, pos), el('mark', {}, rest.slice(pos, pos + want.length))); rest = rest.slice(pos + want.length); }
          p.append(rest);
        } else p.append(l.text);
        return p;
      }) : [el('p', { class: 'qn-foot' }, 'This call has no transcript.')]));
      found.textContent = want ? (hits ? `Found in ${hits} ${hits === 1 ? 'place' : 'places'}` : 'Not found') : '';
      lines.querySelector('mark')?.scrollIntoView({ block: 'center' });
    };
    (async () => {
      if (!transcripts.has(k)) {
        try { transcripts.set(k, transcriptLines((await ask({ action: 'quest_transcript', number: w.number, ...(guide() ? { group: w.group } : {}) })).transcript ?? '')); } catch (err) {
          lines.replaceChildren(el('p', { class: 'qn-foot' }, err.message || 'The transcript could not be opened. Try again when you have signal.'));
          return;
        }
      }
      fill(transcripts.get(k), '');
    })();
    let typing = 0;
    search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { if (transcripts.has(k)) fill(transcripts.get(k), search.value); }, 200); });
    return [top(back(`Week ${w.number} call`), crumb('Group Calls')), eyebrow(`WEEK ${w.number} · TRANSCRIPT`), heading(w.title || `Week ${w.number} call`), search, found, lines];
  }

  // ---- Stuck? Ask Daniel, from go Sovran's first screen (the owner, 28 Nov: separate from the Quest) ----
  function openStuck() {
    const sheet = $('sheet');
    const words = el('textarea', { class: 'sheet-text', rows: '4', placeholder: 'What would you like to ask Daniel?', 'aria-label': 'Your question for Daniel' });
    const status = el('p', { class: 'status', role: 'status' });
    const send = el('button', { type: 'button', class: 'sheet-save', disabled: true }, 'Send to Daniel');
    words.addEventListener('input', () => { send.disabled = !words.value.trim(); });
    send.addEventListener('click', async () => {
      send.disabled = true; status.textContent = '';
      try {
        const w = current();
        const answer = await ask({ action: 'tell', kind: 'question', why: words.value.trim(), place: 'app', context: { from: 'go Sovran', ...(w ? { quest: `Sovran Quest · Week ${w.number}` } : {}) } });
        if (answer.error) throw new Error(answer.error === 'toomany' ? 'That is a lot of questions for one day. Try again tomorrow.' : 'That didn’t go. Try again in a minute.');
        sheet.hidden = true;
        say('Sent to Daniel. His answer comes to your Sovran Central.');
      } catch (err) { status.textContent = err.message; send.disabled = false; }
    });
    sheet.replaceChildren(
      el('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Close', onclick: () => { sheet.hidden = true; } }, '×'),
      el('p', { class: 'sheet-quote' }, 'Ask Daniel'), words, status,
      el('div', { class: 'sheet-actions' }, el('button', { type: 'button', class: 'sheet-quiet', onclick: () => { sheet.hidden = true; } }, 'Cancel'), send));
    sheet.hidden = false;
    words.focus();
  }

  // From the Sovran Quest square: straight onto this week; back goes to the list of weeks.
  async function open() {
    if (!weeks.length) await check();
    if (!weeks.length) return;
    history.pushState({ view: 'qn', s: 'home' }, '');
    go({ s: 'week', week: current().number, tab: 'lessons' });
  }
  function leaving() { stopPlayer(); document.body.classList.remove('in-qn'); }
  const has = () => weeks.length > 0;
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && !$('qn').hidden && where.s !== 'lesson' && where.s !== 'how') { await check(); render(); } });

  return { check, open, render, leaving, openStuck, has };
}
