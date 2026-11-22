// My reports on go Sovran (2026-11-18, the owner's wish): the student's own Sovran reports to read on the phone, in the
// report's Ivory & Gold look, with highlights and comments that match the computer's.
//
// The phone holds no library key. The student's own computer puts sealed copies on a shelf in the phone's drop box
// (phone-shelf.js in the app): the list of reports, each report with its sections already drawn, and the highlights
// and comments. This page reads the shelf with the phone's own token, opens the copies with the key in its link
// (seal.js) and keeps them on the phone, so a report can be read without signal.
//
// Select words: Highlight, Comment, or Ask my Sovran Advisor. A highlight or comment shows at once and travels sealed to the
// computer as a note (kind mark); until the computer has it, it is kept here (sovran.phone.marks). Ask my Sovran Advisor copies
// the words and opens the AI's own app: the student pastes them and asks there.

import { unseal } from './seal.js';
import { textIndex, offsetOf, locate, wrap, wholeWords } from './anchor.js';

const SHELF = 'sovran.phone.shelf';   // { name: { updated_at, sealed } }: the sealed copies, as they came
const MARKS = 'sovran.phone.marks';   // highlights and comments made here that the computer may not have yet
const KEEP_DAYS = 60;
const PICTURES = [[/pattern/i, 'brand/sovran-pattern-report.png']];
const $ = (id) => document.getElementById(id);
const short = (text, n = 140) => { const t = String(text).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}
const dayWords = (day) => (day ? new Date(`${String(day).slice(0, 10)}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const metaLine = (r) => [`Version ${r.version}`, dayWords(r.approved_on), r.words ? `${Number(r.words).toLocaleString()} words` : ''].filter(Boolean).join(' · ');
const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : [...crypto.getRandomValues(new Uint8Array(16))].map((b, i) => (i === 6 ? (b & 15) | 64 : i === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, '0')).join('')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'));

// The highlights as they stand: what the computer has, with what was done here since laid over it, in order.
export function withPending(fromComputer, ops) {
  let marks = fromComputer.map((m) => ({ ...m }));
  for (const op of ops) {
    if (op.op === 'add') { if (!marks.some((m) => m.id === op.id)) marks.push({ ...op.mark, id: op.id, created_at: op.at, updated_at: op.at, asks: [], waiting: true }); }
    else if (op.op === 'comment') { const m = marks.find((x) => x.id === op.id); if (m) Object.assign(m, { comment: op.comment, waiting: true }); }
    else if (op.op === 'remove') marks = marks.filter((m) => m.id !== op.id);
  }
  return marks;
}
// What still waits for the computer: an op is let go once the computer's copy shows it, or after 60 days.
export function stillPending(fromComputer, ops, nowMs = Date.now()) {
  const byId = new Map(fromComputer.map((m) => [m.id, m]));
  const adding = new Set(ops.filter((o) => o.op === 'add' && !byId.has(o.id)).map((o) => o.id));
  return ops.filter((op, i) => {
    if (nowMs - new Date(op.at).getTime() > KEEP_DAYS * 86400_000) return false;
    const m = byId.get(op.id);
    if (op.op === 'add') return !m;
    if (!m) return adding.has(op.id);                 // not on the computer: it waits only while its highlight still does
    if (String(m.updated_at) > String(op.at)) return false; // the computer has had its say since
    if (op.op === 'remove') return true;
    if (op.op !== 'comment') return false;
    if (ops.slice(i + 1).some((o) => o.id === op.id && o.op === 'comment')) return false; // a later comment replaced it
    return m.comment !== op.comment && !String(m.comment ?? '').includes(op.comment || '\u0000');
  });
}

// store: { get, set }; show(name): the page's screens; leave(note): seals a note and leaves it in the drop box (or keeps
// it for later); ai: { href, name } the AI that Ask my Sovran Advisor opens; call(body): one call to the drop box, answering its JSON.
export function setupReports({ link, store, show, leave, ai, call }) {
  const read = (key, fallback) => { try { return JSON.parse(store.get(key) ?? '') ?? fallback; } catch { return fallback; } };
  let shelf = read(SHELF, {});
  let ops = read(MARKS, []);
  const opened = new Map(); // name → { updated_at, value }: a copy opened once
  let reading = null;       // the report on the screen: { report, sections: [{ …, element, notes }], redraw }

  async function open(name) {
    const item = shelf[name];
    if (!item) return null;
    const had = opened.get(name);
    if (had?.updated_at === item.updated_at) return had.value;
    try {
      const value = await unseal(link.key, item.sealed);
      opened.set(name, { updated_at: item.updated_at, value });
      return value;
    } catch { return null; } // not sealed with this phone's key: as if it were not there
  }

  // Reads the shelf: only what changed comes over. Without signal, what the phone holds is used.
  let refreshing = null;
  function refresh() {
    refreshing ??= (async () => {
      let answer;
      try { answer = await call({ action: 'shelf', box: link.box, drop: link.drop, have: Object.fromEntries(Object.entries(shelf).map(([n, it]) => [n, it.updated_at])) }); } catch (err) {
        if (err.refused) { shelf = {}; store.set(SHELF, '{}'); return true; } // the link was replaced: this phone reads no more
        return false;
      }
      if (!Array.isArray(answer?.shelf)) return false; // an older drop box: no shelf yet
      const next = {};
      let changed = Object.keys(shelf).length !== answer.shelf.length;
      for (const it of answer.shelf) {
        if (typeof it.sealed === 'string') { next[it.name] = { updated_at: it.updated_at, sealed: it.sealed }; changed = true; }
        else if (shelf[it.name]) next[it.name] = shelf[it.name];
      }
      shelf = next;
      if (changed) store.set(SHELF, JSON.stringify(shelf));
      return changed;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  const computerMarks = async () => (await open('marks'))?.marks ?? [];
  async function marksOf(report) {
    const all = await computerMarks();
    const left = stillPending(all, ops);
    if (left.length !== ops.length) { ops = left; store.set(MARKS, JSON.stringify(ops)); }
    return withPending(all, ops).filter((m) => m.report === report);
  }
  function did(op) {
    ops = [...ops, op];
    store.set(MARKS, JSON.stringify(ops));
    const { mark, ...rest } = op;
    leave({ kind: 'mark', ...rest, ...(mark ?? {}) }); // sealed, to the computer; kept on the phone until there is signal
  }

  // ---- The list ----
  async function showList() {
    reading = null;
    closeAll();
    document.body.classList.add('reading');
    show('reports');
    const draw = async () => {
      const list = (await open('list'))?.reports ?? [];
      $('reports-list').replaceChildren(...(list.length ? list.map(card)
        : [el('p', { class: 'reports-empty' }, 'Nothing here yet. Your reports appear here once your computer has been on, with Sovran Central up to date and Reports and go Sovran switched on.')]));
    };
    await draw();
    if (await refresh() && !$('reports').hidden) await draw();
  }
  function card(r) {
    const picture = PICTURES.find(([match]) => match.test(`${r.report} ${r.title}`))?.[1];
    return el('button', { type: 'button', class: 'report-card', 'data-report': r.report, onclick: () => { history.pushState({ view: 'report', report: r.report }, ''); showReport(r.report); } },
      el('img', { class: picture ? 'report-card-picture' : 'report-card-crown', src: picture ?? 'brand/official-crimson-crown.png', alt: '' }),
      el('span', { class: 'report-card-label' }, 'Sovran report'),
      el('span', { class: 'report-card-title' }, r.title),
      el('span', { class: 'report-card-rule', 'aria-hidden': 'true' }),
      r.about ? el('span', { class: 'report-card-about' }, r.about) : null,
      el('span', { class: 'report-card-meta' }, metaLine(r)),
      el('span', { class: 'report-card-open' }, 'Open report'));
  }

  // ---- One report ----
  async function showReport(name) {
    closeAll();
    document.body.classList.add('reading');
    show('report');
    const place = $('report-paper');
    const drawn = async () => {
      const r = (await open(`report.${name}`))?.report;
      if (!r) {
        reading = null;
        place.replaceChildren(el('p', { class: 'reports-empty' }, 'This report is not on this phone yet. It comes once your computer has been on.'));
        return;
      }
      const anchor = (s) => `section-${s.section_key}`;
      const main = r.sections.filter((s) => s.level === 1);
      const sections = r.sections.map((s) => {
        const text = el('div', { class: 'report-text' });
        text.innerHTML = s.html; // drawn on the student's own computer (no HTML from the report's text), sealed for this phone
        if (s.part) text.querySelector(':scope > p')?.classList.add('report-lede'); // the drop cap
        const notes = el('aside', { class: 'report-notes', 'aria-label': `Your comments on ${s.title}`, hidden: true });
        return { ...s, element: text, original: text.innerHTML, notes,
          node: el('section', { class: `report-section report-level-${s.level}`, id: anchor(s), 'data-section': s.section_key },
            s.part ? el('p', { class: 'report-part-label' }, `Part ${s.part}`) : null,
            el(s.level === 2 ? 'h3' : 'h2', { class: 'report-section-title' }, s.title), text, notes) };
      });
      place.replaceChildren(
        el('header', { class: 'report-cover' },
          el('img', { class: 'report-crown', src: 'brand/official-crimson-crown.png', alt: '' }),
          el('h1', { class: 'report-title' }, r.title),
          el('div', { class: 'report-rule', 'aria-hidden': 'true' }),
          el('img', { class: 'report-wordmark', src: 'brand/official-wordmark.png', alt: 'Live Sovran' }),
          el('p', { class: 'report-meta' }, metaLine(r))),
        el('p', { class: 'report-hint' }, `Select any words to highlight them, add a comment or ask ${ai.name} about them.`),
        main.length > 1 ? el('nav', { class: 'report-contents', 'aria-label': 'Contents' },
          el('h2', { class: 'report-contents-title' }, 'Contents'),
          el('ol', {}, ...main.map((s) => el('li', {}, el('button', { type: 'button', class: 'report-contents-link',
            onclick: () => document.getElementById(anchor(s))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, s.title))))) : null,
        ...sections.map((s) => s.node));
      reading = { report: r, sections, marks: [] };
      await drawMarks();
    };
    await drawn();
    if (await refresh() && !$('report').hidden) { if (reading && !(await open(`report.${name}`))) reading = null; if (!chosen && $('sheet').hidden) await (reading ? drawMarks() : drawn()); }
  }

  // Every highlight drawn afresh on its words; the comments under their section.
  async function drawMarks() {
    if (!reading) return;
    const { report, sections } = reading;
    reading.marks = await marksOf(report.report);
    for (const s of sections) { s.element.innerHTML = s.original; s.notes.replaceChildren(); s.notes.hidden = true; }
    for (const m of reading.marks) {
      const home = sections.find((s) => s.section_key === m.section_key);
      for (const s of home ? [home, ...sections.filter((x) => x !== home)] : sections) {
        const index = textIndex(s.element);
        const at = locate(index.text, m);
        if (!at) continue;
        wrap(index, at.start, at.end, { class: ['report-mark', m.comment ? 'has-comment' : '', m.asks?.length ? 'has-ask' : ''].filter(Boolean).join(' '), 'data-mark': m.id, tabindex: '0' });
        const asked = (m.asks ?? []).filter((a) => a.role === 'user');
        if (m.comment || asked.length) {
          s.notes.hidden = false;
          s.notes.append(el('button', { type: 'button', class: 'report-note', 'data-mark': m.id, onclick: () => openMark(m.id) },
            el('span', { class: 'report-note-quote' }, `“${short(m.quote, 70)}”`),
            m.comment ? el('span', { class: 'report-note-comment' }, m.comment) : null,
            asked.length ? el('span', { class: 'report-note-asked' }, `You asked: ${short(asked.at(-1).text, 120)}`) : null));
        }
        break;
      }
    }
  }

  // ---- Selecting words: the bar at the bottom ----
  let chosen = null;
  let barTouched = 0;
  const pick = $('pick');
  const sheet = $('sheet');
  function closeAll() { pick.hidden = true; sheet.hidden = true; sheet.replaceChildren(); chosen = null; }
  function selectionInfo() {
    const sel = window.getSelection();
    if (!reading || !sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const section = reading.sections.find((s) => s.element.contains(range.startContainer) && s.element.contains(range.endContainer));
    if (!section) return null;
    const index = textIndex(section.element);
    const start = offsetOf(section.element, range.startContainer, range.startOffset);
    const end = offsetOf(section.element, range.endContainer, range.endOffset);
    if (start == null || end == null || end <= start) return null;
    const words = wholeWords(index.text, start, end);
    return words ? { section, ...words } : null;
  }
  // Where the bar sits: the phone's own things take the bottom edge (Android's "Tap to see search results") and the
  // space just above the selected words (Copy · Select all), so the bar goes a little up from the bottom when the
  // words are in the upper part of the screen, and to the top when they are low.
  function placePick() {
    const sel = window.getSelection();
    const box = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const low = box && box.bottom > window.innerHeight - 230;
    pick.classList.toggle('is-top', Boolean(low));
  }
  window.addEventListener('scroll', () => { if (!pick.hidden) placePick(); }, { passive: true }); // the chosen words moved on the screen
  let settling = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(settling);
    settling = setTimeout(() => {
      if ($('report').hidden || !sheet.hidden) return;
      const info = selectionInfo();
      if (info) { chosen = info; placePick(); pick.hidden = false; }
      else if (Date.now() - barTouched > 700) { chosen = null; pick.hidden = true; } // a tap on the bar may clear the selection first
    }, 200);
  });
  pick.addEventListener('pointerdown', () => { barTouched = Date.now(); });
  pick.addEventListener('mousedown', (e) => e.preventDefault()); // the words stay selected while the bar is pressed

  async function keep(comment = '') {
    if (!chosen || !reading) return;
    const { section, quote, prefix, suffix } = chosen;
    did({ op: 'add', id: newId(), at: new Date().toISOString(), mark: { report: reading.report.report, version: reading.report.version, section_key: section.section_key, quote, prefix, suffix, comment: comment.trim() } });
    window.getSelection()?.removeAllRanges();
    closeAll();
    await drawMarks();
  }
  function commentSheet({ quote, comment = '', save, mark = null }) {
    pick.hidden = true;
    const box = el('textarea', { class: 'sheet-text', rows: 4, placeholder: 'Your comment…', 'aria-label': 'Your comment', maxlength: 4000 });
    box.value = comment;
    const asks = (mark?.asks ?? []).map((a) => el('p', { class: a.role === 'user' ? 'sheet-asked' : 'sheet-answer' }, a.role === 'user' ? `You asked: ${a.text}` : a.text));
    let sure = false;
    const remove = mark ? el('button', { type: 'button', class: 'sheet-quiet', onclick: async () => {
      if (!sure) { sure = true; remove.textContent = 'Tap again to remove'; return; }
      did({ op: 'remove', id: mark.id, at: new Date().toISOString() });
      closeAll();
      await drawMarks();
    } }, 'Remove highlight') : el('button', { type: 'button', class: 'sheet-quiet', onclick: () => closeAll() }, 'Cancel');
    sheet.replaceChildren(...[
      el('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Close', onclick: () => closeAll() }, '×'),
      el('p', { class: 'sheet-quote' }, `“${short(quote, 160)}”`),
      ...asks,
      box,
      el('div', { class: 'sheet-actions' }, remove, el('button', { type: 'button', class: 'sheet-save', onclick: () => save(box.value) }, mark ? 'Save' : 'Save comment')),
      mark?.waiting ? el('p', { class: 'sheet-waiting' }, 'It reaches your computer when it is next on.') : null].filter(Boolean));
    sheet.hidden = false;
    if (!mark) box.focus();
  }
  function openMark(id) {
    const m = reading?.marks.find((x) => x.id === id);
    if (!m) return;
    commentSheet({ quote: m.quote, comment: m.comment, mark: m, save: async (words) => {
      if (words.trim() !== m.comment) did({ op: 'comment', id: m.id, at: new Date().toISOString(), comment: words.trim(), was: m.comment });
      closeAll();
      await drawMarks();
    } });
  }
  $('pick-highlight').addEventListener('click', () => keep(''));
  $('pick-comment').addEventListener('click', () => { if (chosen) { const held = chosen; commentSheet({ quote: held.quote, save: (words) => { chosen = held; return keep(words); } }); chosen = held; } });
  // Ask my Sovran Advisor: a real link the person taps (so the phone hands it to the AI's own app). Where the AI's app takes words
  // in its address (Claude), they arrive in its box; they are copied as well, for a paste.
  const ask = $('pick-ask');
  ask.href = ai.href;
  $('pick-ask-words').textContent = 'Ask my Sovran Advisor';
  ask.addEventListener('click', () => {
    if (!chosen || !reading) return;
    const words = `From my ${reading.report.title.replace(/^Your\s+/i, '')}: “${chosen.quote.replace(/\s+/g, ' ')}”\n\n${ai.ask ? ai.ask + '\n\n' : ''}My question: `;
    copy(words); // always, so a paste still works where the app opens with an empty box
    const fills = Boolean(ai.fill) && words.length <= 1800; // a very long passage would make too long an address
    ask.href = fills ? ai.fill + encodeURIComponent(words) : ai.href;
    say(fills ? `Opening ${ai.name} with your words in the box. Add your question.` : `Copied. Paste it into ${ai.name} and add your question.`);
    window.getSelection()?.removeAllRanges();
    pick.hidden = true;
    chosen = null;
  });
  function copy(words) {
    try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(words).catch(() => oldCopy(words)); return; } } catch { /* then the older way */ }
    oldCopy(words);
  }
  function oldCopy(words) {
    const box = el('textarea', { class: 'copy-box', readonly: true });
    box.value = words;
    document.body.append(box);
    box.select();
    try { document.execCommand('copy'); } catch { /* nothing copied: the words are still on the page */ }
    box.remove();
  }
  let saying = 0;
  function say(words) {
    $('toast').textContent = words;
    $('toast').hidden = false;
    clearTimeout(saying);
    saying = setTimeout(() => { $('toast').hidden = true; }, 6000);
  }
  $('report-paper').addEventListener('click', (event) => {
    const mark = event.target.closest?.('mark.report-mark');
    if (mark && window.getSelection()?.isCollapsed) openMark(mark.dataset.mark);
  });
  $('report-paper').addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target.matches?.('mark.report-mark')) openMark(event.target.dataset.mark); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && (!sheet.hidden || !pick.hidden)) closeAll(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !$('sheet').hidden || chosen) return;
    if (!(await refresh())) return;
    if (!$('report').hidden && reading) await drawMarks(); else if (!$('reports').hidden) await showList();
  });

  return { showList, showReport, leaveReports: () => { closeAll(); reading = null; document.body.classList.remove('reading'); }, refresh, open };
}
