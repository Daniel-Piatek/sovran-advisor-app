// Sovran Quest on go Sovran (2026-11-23, the owner's design): the student's Quest weeks on their phone, as on the
// computer's Quest page. One screen per week: today's practice, the homework with Done and a start for each piece, and
// the group call (its summary, the replay and the transcript, with search).
//
// Where things come from:
//   the weeks       the Sovran cloud's Quest shelf (cloud/quest.sql), read with the phone's own Group Circle key
//                   (group.js ask), so only the student's own group. The transcript only when it is opened.
//   Done and work   the student's own, kept on their computer (quest.js quest_marks, quest_work). The computer leaves
//                   them on the phone's sealed shelf (phone-shelf.js, item "quest"); a Done ticked here, or a journal
//                   entry written here, goes back as a sealed note (phone-drop.js) and shows here at once.
//   Stuck?          Tell Daniel, with the phone's key (cloud/tell-daniel.sql), the week and the piece.
// Daniel's own go Sovran (the guide's key) shows the weeks as his students see them, without Done or the starts.

const $ = (id) => document.getElementById(id);
const PENDING = 'sovran.phone.quest-pending'; // Done ticks and journal entries sent from here, until the computer has them
const WEEKS = 'sovran.phone.quest-weeks';     // the last weeks read, for a phone without signal (never a transcript)
const SHORT_SUMMARY = 220;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

// ---- The homework and the summary as Daniel formatted them (2026-11-24, public/format-bar.js on the computer) ----
// The same Markdown as on the computer: paragraphs, - and 1. lists, **bold**, *italic*, ~~strikethrough~~, `code`,
// [words](https://…), and [words]{.underline}, [words]{.c-red} (a colour), [words]{.hl-red} (a highlight). Built as
// elements, never as HTML, so nothing in the words can run.
const COLOURS = 'crimson gold violet red orange yellow green teal blue pink brown grey'.split(' ');
const ESCAPED = /[\\`*_{}[\]()#+\-.!>~]/;
function closeBracket(src, at) { // the ] that closes the [ at `at`, or -1
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '[') depth++;
    if (src[i] === ']' && --depth === 0) return i;
  }
  return -1;
}
function closeMark(src, from, mark) {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src.startsWith(mark, i) && (mark.length > 1 || src[i + 1] !== mark)) return i;
  }
  return -1;
}
const spanTag = (name) => {
  if (name === 'underline') return () => el('u');
  const [, kind, colour] = /^(c|hl)-([a-z]+)$/.exec(name) ?? [];
  if (!COLOURS.includes(colour)) return null;
  return kind === 'c' ? () => el('span', { class: `fc-${colour}` }) : () => el('mark', { class: `hl-${colour}` });
};
const MARKS = { '**': 'strong', __: 'strong', '~~': 's', '*': 'em', _: 'em' };
function inline(src) {
  const out = [];
  let words = '';
  const flush = () => { if (words) out.push(document.createTextNode(words)); words = ''; };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    // A backslash at the end of a line is the computer's line break (Shift-Enter), not a word.
    if (c === '\\' && src[i + 1] === '\n') { flush(); out.push(el('br')); i += 2; continue; }
    if (c === '\\' && i === src.length - 1) { i++; continue; }
    if (c === '\\' && ESCAPED.test(src[i + 1] ?? '')) { words += src[i + 1]; i += 2; continue; }
    if (c === '\n') { flush(); out.push(el('br')); i++; continue; }
    if (c === '[') {
      const end = closeBracket(src, i);
      const rest = end > 0 ? src.slice(end + 1) : '';
      const span = /^\{((?:\s*\.[a-z-]+)+)\s*\}/.exec(rest);
      const makers = span ? span[1].trim().split(/\s+/).map((name) => spanTag(name.slice(1))) : [];
      if (span && makers.every(Boolean)) {
        flush();
        let node = null;
        for (const make of [...makers].reverse()) { const outer = make(); outer.append(...(node ? [node] : inline(src.slice(i + 1, end)))); node = outer; }
        out.push(node);
        i = end + 1 + span[0].length;
        continue;
      }
      const link = end > 0 ? /^\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest) : null;
      if (link) {
        flush();
        const href = safeUrl(link[1]);
        const kids = inline(src.slice(i + 1, end));
        out.push(...(href ? [el('a', { href, target: '_blank', rel: 'noopener' }, ...kids)] : kids));
        i = end + 1 + link[0].length;
        continue;
      }
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push(el('code', {}, src.slice(i + 1, end))); i = end + 1; continue; }
    }
    const mark = ['**', '__', '~~', '*', '_'].find((m) => src.startsWith(m, i));
    const opens = mark && /\S/.test(src[i + mark.length] ?? '') && !(mark[0] === '_' && /\w/.test(src[i - 1] ?? ''));
    const end = opens ? closeMark(src, i + mark.length, mark) : -1;
    if (end > 0 && /\S/.test(src[end - 1])) {
      flush();
      out.push(el(MARKS[mark], {}, ...inline(src.slice(i + mark.length, end))));
      i = end + mark.length;
      continue;
    }
    words += c;
    i++;
  }
  flush();
  return out;
}
export function richText(markdown) {
  const blocks = [];
  let list = null;
  for (const part of String(markdown ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = part.split('\n');
    const item = (line) => /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
    if (lines.every((line) => !line.trim() || item(line) || /^\s{2,}\S/.test(line))) {
      for (const line of lines.filter((l) => l.trim())) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        if (!item(line) && list) { list.lastChild?.append(el('br'), ...inline(line.trim())); continue; }
        const tag = ordered ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== tag) { list = el(tag, { class: 'q-list' }); blocks.push(list); }
        list.append(el('li', {}, ...inline(line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '').replace(/^\[( |x|X)\]\s/, ''))));
      }
      continue;
    }
    list = null;
    blocks.push(el('p', {}, ...inline(part.replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, ''))));
  }
  return blocks;
}
// The words alone, for the AI's box and a short summary.
export const plainText = (markdown) => richText(markdown).map((node) => node.textContent).join('\n');

const two = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const callDay = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '');
const shortDay = (day) => (/^\d{4}-\d{2}-\d{2}/.test(day ?? '') ? new Date(`${String(day).slice(0, 10)}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
export const weekKey = (group, number) => `${group}-${number}`;
export const labelOf = (number, piece) => `Sovran Quest · Week ${number} · Homework ${piece}`;
const safeUrl = (url) => (/^https:\/\/[^\s]+$/i.test(String(url ?? '')) ? url : '');

// A transcript as Google's Gemini notes write it (the same reading as the computer's quest.js transcriptLines):
// "### **00:12:04**" headings for the time, then "**Name Surname:** what was said". → [{ at, who, text }]
export function transcriptLines(text) {
  const lines = [];
  let at = '';
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const time = line.match(/^#{1,4}\s*\**\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\**\s*$/);
    if (time) { at = time[1]; continue; }
    if (/^#/.test(line)) continue;
    const turn = line.match(/^\*\*([^*:]{1,60}):\*\*\s*(.*)$/) || line.match(/^\*\*([^*]{1,60})\*\*:\s*(.*)$/);
    if (turn) lines.push({ at, who: turn[1].trim(), text: turn[2].trim() });
    else if (lines.length) lines[lines.length - 1].text += ` ${line}`;
    else lines.push({ at, who: '', text: line });
  }
  return lines;
}

// What the student has done on a piece: the computer's word (the shelf), with what was sent from here since.
// shelf: { at, marks: [{ week, piece, done, entries, last }] }; pending: [{ week, piece, done?, entry?, at }]
export function standing(shelf, pending, week, piece) {
  const mark = (shelf?.marks ?? []).find((m) => m.week === week && m.piece === piece) ?? { done: false, entries: 0, last: '' };
  const since = pending.filter((p) => p.week === week && p.piece === piece && (!shelf?.at || p.at > shelf.at));
  const tick = since.filter((p) => typeof p.done === 'boolean').pop();
  const written = since.filter((p) => p.entry);
  return { done: tick ? tick.done : Boolean(mark.done), entries: (mark.entries ?? 0) + written.length, last: written.length ? written.at(-1).at : mark.last ?? '', waiting: written.length };
}

// ask(body): one call to the Sovran cloud with the phone's Group Circle key (group.js); available(): is the key here.
// openShelf(name): a sealed shelf item, opened (reports.js). leave(note): seals a note for the computer (phone.js).
// show(id): the screen to show. ai: the AI that Ask my Sovran Advisor opens. say(words): a short line that goes away.
export function setupQuest({ store, show, ask, available, isGuide, openShelf, leave, ai, say }) {
  const read = (key, fallback) => { try { return JSON.parse(store.get(key) ?? '') ?? fallback; } catch { return fallback; } };
  let weeks = read(WEEKS, []);
  let pending = read(PENDING, []);
  let shelf = null;
  let chosen = null; // the week on the screen (its number)
  let writing = null; // { week, piece } while writing in the journal screen
  const transcripts = new Map(); // week key → lines, while the page is open

  const keepPending = () => {
    if (shelf?.at) pending = pending.filter((p) => p.at > shelf.at); // the computer has these now
    store.set(PENDING, JSON.stringify(pending.slice(-200)));
  };
  const guide = () => Boolean(isGuide());
  const shown = () => weeks.find((w) => w.number === chosen) ?? weeks[0];

  // Reads the weeks (and the student's own Done from the shelf), then sets the tile on the first screen.
  async function check() {
    shelf = await openShelf('quest').catch(() => null); // { at, marks }
    if (shelf && !Array.isArray(shelf.marks)) shelf = null;
    keepPending();
    if (available()) {
      try {
        const answer = await ask({ action: 'quest_weeks' });
        if (Array.isArray(answer.weeks)) {
          // Never a week before it opens (APP Daniel sends a week only when it opens; this is the second lock).
          let list = answer.weeks.filter((w) => w && Number.isInteger(w.number) && (!w.opens_at || Date.parse(w.opens_at) <= Date.now()));
          // The guide sees every group: the newest group's weeks, as one of its students sees them.
          if (guide() && list.length) list = list.filter((w) => w.group === list[0].group);
          // The student's own practice link (Daniel adds one for each student, 2026-11-24) stands in for the week's.
          const own = typeof answer.practice_url === 'string' && safeUrl(answer.practice_url) ? answer.practice_url : '';
          weeks = list.sort((a, b) => b.number - a.number).map(({ transcript: _t, ...w }) => (own ? { ...w, practice_url: own } : w));
          store.set(WEEKS, JSON.stringify(weeks));
        }
      } catch { /* no signal: the weeks read last time */ }
    } else weeks = [];
    tile();
  }

  function tile() {
    const has = available() && weeks.length > 0;
    $('quest-tile').hidden = !has;
    if (!has) return;
    const w = weeks[0];
    const pieces = (w.homework ?? []).length;
    const done = (w.homework ?? []).filter((_, i) => standing(shelf, pending, weekKey(w.group, w.number), i + 1).done).length;
    $('quest-line').textContent = guide() || !pieces ? `Week ${w.number}` : `Week ${w.number} · ${done} of ${pieces} done`;
  }

  // The week screen.
  function draw() {
    const w = shown();
    if (!w) { $('quest-body').replaceChildren(el('p', { class: 'q-note' }, 'No weeks yet. They appear here after each group call.')); return; }
    chosen = w.number;
    const key = weekKey(w.group, w.number);
    $('quest-weeks').replaceChildren(...weeks.map((x) => el('button', { type: 'button', 'aria-pressed': String(x.number === w.number),
      onclick: () => { chosen = x.number; draw(); scrollTo(0, 0); } }, `Week ${x.number}`)));
    const parts = [];
    parts.push(el('div', { class: 'q-head' },
      w.call_on ? el('p', { class: 'q-when' }, `Call ${callDay(w.call_on)}`) : null,
      el('h2', { class: 'q-name' }, w.title || `Week ${w.number}`)));
    const practice = safeUrl(w.practice_url);
    if (practice) parts.push(el('a', { class: 'q-practice', href: practice, target: '_blank', rel: 'noopener' }, 'Open today’s practice ↗'));

    const homework = w.homework ?? [];
    if (homework.length) {
      parts.push(el('p', { class: 'q-label' }, 'Homework'));
      homework.forEach((h, i) => {
        const piece = i + 1;
        const s = standing(shelf, pending, key, piece);
        const acts = [];
        if (!guide()) {
          if (h.where === 'journal') acts.push(el('button', { type: 'button', class: 'q-start', onclick: () => openWriting(w, piece) }, 'Start in my Journal'));
          if (h.where === 'advisor') acts.push(advisorLink(w, piece, h));
          acts.push(el('button', { type: 'button', class: 'q-done', 'aria-pressed': String(s.done), onclick: () => tick(w, piece, !s.done) }, s.done ? '✓ Done' : 'Done'));
        }
        const work = s.entries ? `${s.entries} Journal ${s.entries === 1 ? 'entry' : 'entries'}${s.last ? `, ${shortDay(s.last)}` : ''}${s.waiting ? ' (goes to your computer when it’s on)' : ''}` : '';
        parts.push(el('div', { class: 'q-piece' },
          el('div', { class: 'q-row' }, el('span', { class: 'q-n', 'aria-hidden': 'true' }, String(piece)), el('div', { class: 'q-rich' }, ...richText(h.text))),
          acts.length ? el('div', { class: 'q-acts' }, ...acts) : null,
          work ? el('p', { class: 'q-work' }, work) : null));
      });
    }

    const replay = safeUrl(w.replay_url);
    if (w.summary || replay || w.has_transcript) {
      parts.push(el('p', { class: 'q-label' }, 'The call'));
      const call = el('div', { class: 'q-call' });
      if (w.summary) {
        // A long summary shows its first words; the whole of it, as formatted, on Read the whole summary.
        const words = plainText(w.summary);
        const long = words.length > SHORT_SUMMARY;
        const text = long ? el('p', { class: 'q-sum' }, `${words.slice(0, SHORT_SUMMARY).replace(/\s+\S*$/, '')}…`) : el('div', { class: 'q-sum q-rich' }, ...richText(w.summary));
        call.append(text);
        if (long) {
          const more = el('button', { type: 'button', class: 'q-more', onclick: () => { text.replaceWith(el('div', { class: 'q-sum q-rich' }, ...richText(w.summary))); more.remove(); } }, 'Read the whole summary');
          call.append(more);
        }
      }
      const links = el('div', { class: 'q-links' });
      if (replay) links.append(el('a', { class: 'q-link', href: replay, target: '_blank', rel: 'noopener' }, '▶ Watch the replay ↗'));
      if (w.has_transcript) links.append(el('button', { type: 'button', class: 'q-link', onclick: () => openTranscript(w) }, 'Read the transcript ›'));
      if (links.childElementCount) call.append(links);
      parts.push(call);
    }
    if (!guide()) parts.push(el('button', { type: 'button', class: 'q-stuck', onclick: () => openStuck(w) }, 'Stuck? Ask Daniel'));
    $('quest-body').replaceChildren(...parts);
  }

  function tick(w, piece, on) {
    const week = weekKey(w.group, w.number);
    const at = new Date().toISOString();
    pending.push({ week, piece, done: on, at });
    keepPending();
    leave({ kind: 'quest_done', group: w.group, number: w.number, piece, on, at });
    draw();
    tile();
  }

  // Ask my Sovran Advisor on a piece: the AI's own app, with the homework in its box where it takes words (as reports.js).
  function advisorLink(w, piece, h) {
    const words = `I'm working on this week's homework (${labelOf(w.number, piece)}): “${plainText(h.text).replace(/\s*\n\s*/g, ' ')}”\n\n${ai.ask ? `${ai.ask}\n\n` : ''}`;
    const fills = Boolean(ai.fill) && words.length <= 1800;
    return el('a', { class: 'q-start', href: fills ? ai.fill + encodeURIComponent(words) : ai.href, target: '_blank', rel: 'noopener',
      onclick: () => { copy(words); say(fills ? `Opening ${ai.name} with the homework in the box.` : `Copied. Paste it into ${ai.name}.`); } }, 'Ask my Sovran Advisor');
  }
  function copy(words) {
    try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(words).catch(() => {}); } } catch { /* nothing copied: the words are still on the page */ }
  }

  // Start in my Journal: write here; it goes to the Journal on the computer, named for the piece, under it there too.
  function openWriting(w, piece) {
    writing = { w, piece };
    history.pushState({ view: 'quest-write' }, '');
    drawWriting();
  }
  function drawWriting() {
    if (!writing) return;
    const { w, piece } = writing;
    const h = w.homework[piece - 1];
    $('quest-write-title').textContent = `Homework ${piece}`;
    $('quest-write-label').textContent = labelOf(w.number, piece);
    $('quest-write-quote').replaceChildren(...richText(h.text));
    $('quest-write-status').textContent = '';
    const text = $('quest-write-text');
    text.value = read(`sovran.phone.quest-draft.${weekKey(w.group, w.number)}.${piece}`, '') || '';
    $('quest-write-save').disabled = !text.value.trim();
    show('quest-write');
    text.focus();
  }
  async function saveWriting(event) {
    event.preventDefault();
    if (!writing) return;
    const { w, piece } = writing;
    const body = $('quest-write-text').value.trim();
    if (!body) return;
    const at = new Date();
    const week = weekKey(w.group, w.number);
    $('quest-write-save').disabled = true;
    await leave({ kind: 'journal', body, at: at.toISOString(), day: localDay(at), quest: { group: w.group, number: w.number, piece, text: w.homework[piece - 1].text } });
    pending.push({ week, piece, entry: true, at: at.toISOString() });
    keepPending();
    store.set(`sovran.phone.quest-draft.${week}.${piece}`, '');
    $('quest-write-text').value = '';
    say('Saved. It will be in your Journal when your computer is on.');
    writing = null;
    history.back();
  }
  $('quest-write-form').addEventListener('submit', saveWriting);
  $('quest-write-text').addEventListener('input', () => {
    const text = $('quest-write-text');
    $('quest-write-save').disabled = !text.value.trim();
    text.style.height = 'auto'; text.style.height = `${text.scrollHeight}px`;
    if (writing) store.set(`sovran.phone.quest-draft.${weekKey(writing.w.group, writing.w.number)}.${writing.piece}`, JSON.stringify(text.value));
  });

  // The transcript, asked for when opened, with search.
  async function openTranscript(w) {
    history.pushState({ view: 'quest-transcript', week: w.number }, '');
    await drawTranscript(w.number);
  }
  async function drawTranscript(number) {
    const w = weeks.find((x) => x.number === number) ?? shown();
    if (!w) return;
    chosen = w.number;
    const key = weekKey(w.group, w.number);
    $('quest-tr-title').textContent = `Week ${w.number} transcript`;
    $('quest-tr-search').value = '';
    $('quest-tr-found').hidden = true;
    show('quest-transcript');
    if (!transcripts.has(key)) {
      $('quest-tr-lines').replaceChildren(el('p', { class: 'q-note' }, 'Opening the transcript…'));
      try {
        const answer = await ask({ action: 'quest_transcript', number: w.number, ...(guide() ? { group: w.group } : {}) });
        transcripts.set(key, transcriptLines(answer.transcript ?? ''));
      } catch (err) {
        $('quest-tr-lines').replaceChildren(el('p', { class: 'q-note' }, err.message || 'The transcript could not be opened. Try again when you have signal.'));
        return;
      }
    }
    lines(transcripts.get(key), '');
  }
  let hits = [];
  let at = 0;
  function lines(list, look) {
    const want = look.trim().toLowerCase();
    hits = [];
    const nodes = list.map((l, i) => {
      const p = el('p', { 'data-line': String(i) }, el('b', {}, l.who || ' ', l.at ? el('span', { class: 'q-at' }, l.at) : null));
      if (want && l.text.toLowerCase().includes(want)) {
        hits.push(i);
        let rest = l.text;
        let pos;
        while ((pos = rest.toLowerCase().indexOf(want)) >= 0) {
          p.append(rest.slice(0, pos), el('mark', {}, rest.slice(pos, pos + want.length)));
          rest = rest.slice(pos + want.length);
        }
        p.append(rest);
      } else p.append(l.text);
      return p;
    });
    $('quest-tr-lines').replaceChildren(...(nodes.length ? nodes : [el('p', { class: 'q-note' }, 'This call has no transcript.')]));
    at = 0;
    $('quest-tr-found').hidden = !want;
    $('quest-tr-found-words').textContent = want ? (hits.length ? `${hits.length} ${hits.length === 1 ? 'place' : 'places'} · 1 of ${hits.length}` : 'Not found') : '';
    $('quest-tr-prev').hidden = hits.length < 2;
    $('quest-tr-next').hidden = hits.length < 2;
    if (hits.length) go(0);
  }
  function go(n) {
    if (!hits.length) return;
    at = (n + hits.length) % hits.length;
    $('quest-tr-found-words').textContent = `${hits.length} ${hits.length === 1 ? 'place' : 'places'} · ${at + 1} of ${hits.length}`;
    document.querySelector(`#quest-tr-lines [data-line="${hits[at]}"]`)?.scrollIntoView({ block: 'center' });
  }
  let typing = 0;
  $('quest-tr-search').addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { const w = shown(); const list = w ? transcripts.get(weekKey(w.group, w.number)) : null; if (list) lines(list, $('quest-tr-search').value); }, 200);
  });
  $('quest-tr-prev').addEventListener('click', () => go(at - 1));
  $('quest-tr-next').addEventListener('click', () => go(at + 1));

  // Stuck? Ask Daniel: their question, with the week, through Tell Daniel.
  function openStuck(w) {
    const sheet = $('sheet');
    const words = el('textarea', { class: 'sheet-text', rows: '4', placeholder: 'What would you like to ask Daniel?', 'aria-label': 'Your question for Daniel' });
    const status = el('p', { class: 'status', role: 'status' });
    const send = el('button', { type: 'button', class: 'sheet-save', disabled: true }, 'Send to Daniel');
    words.addEventListener('input', () => { send.disabled = !words.value.trim(); });
    send.addEventListener('click', async () => {
      send.disabled = true;
      status.textContent = '';
      try {
        const answer = await ask({ action: 'tell', kind: 'question', why: words.value.trim(), place: 'app', context: { quest: `Sovran Quest · Week ${w.number}`, week: w.title || `Week ${w.number}`, from: 'go Sovran' } });
        if (answer.error) throw new Error(answer.error === 'toomany' ? 'That is a lot of questions for one day. Try again tomorrow.' : 'That didn’t go. Try again in a minute.');
        sheet.hidden = true;
        say('Sent to Daniel. His answer comes to your Sovran Central.');
      } catch (err) { status.textContent = err.message; send.disabled = false; }
    });
    sheet.replaceChildren(
      el('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Close', onclick: () => { sheet.hidden = true; } }, '×'),
      el('p', { class: 'sheet-quote' }, `Sovran Quest · Week ${w.number}${w.title ? ` · ${w.title}` : ''}`), words, status,
      el('div', { class: 'sheet-actions' }, el('button', { type: 'button', class: 'sheet-quiet', onclick: () => { sheet.hidden = true; } }, 'Cancel'), send));
    sheet.hidden = false;
    words.focus();
  }

  function open() {
    if (!weeks.length) return;
    if (!weeks.some((w) => w.number === chosen)) chosen = weeks[0].number;
    show('quest');
    draw();
  }
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && !$('quest').hidden) { await check(); draw(); } });

  return { check, open, draw, drawWriting, drawTranscript, tile };
}
