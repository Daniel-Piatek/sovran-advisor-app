// Highlights and comments on a report (Reports, 2026-11-16, the owner's wish). Select words in a section: Highlight, or Comment
// to add your own words. They show in soft gold (the Assistant's wash), the comments beside the section (under it on a phone), and
// all of them in Your highlights at the top. The report itself is never changed: the marks are rows kept in this app
// (report-marks.js on the server). A mark finds its place again by its words, with a little of the text before and after, so it
// survives a newer version of the report; one whose words are gone is listed as no longer found, never lost.
// Ask about this (2026-11-17, the owner's wish): select words, press the robot's Ask about this, and ask your assistant about
// them. The answer streams in beside the words, and the questions and answers stay there (in the margin, gold-edged), kept as
// that highlight's own chat: also in the Assistant's list of chats, and read by the assistant with the report.

import markdownit from '/vendor/markdown-it/index.mjs';
import { el, icon, request, undoBar } from './ui.js';
import { moduleOn } from './modules.js';
import { openTellDaniel } from './tell-daniel.js';

const markdown = markdownit({ html: false, linkify: true });
// What the assistant is doing, in words, while the answer has not begun.
const STEP_WORDS = [[/reports_read/, 'Reading your report…'], [/library|decode/, 'Looking in your decodes…'], [/./, 'Thinking…']];
const stepWords = (tool) => STEP_WORDS.find(([match]) => match.test(tool))[1];

const AROUND = 32; // letters kept before and after the words, to tell one place from another
const short = (text, n = 140) => { const t = String(text).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// The words of one section as one string, with each text node's place in it.
function textIndex(root) {
  const nodes = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) { nodes.push({ node, start: text.length }); text += node.data; }
  return { text, nodes };
}
// A point in the page as a place in a section's text: the length of the words from the section's start up to it.
function offsetOf(root, container, offset) {
  const range = document.createRange();
  range.setStart(root, 0);
  try { range.setEnd(container, offset); } catch { return null; }
  return range.toString().length;
}

// Where a mark's words are in a section's text, best by the words around them, or null.
export function locate(text, { quote, prefix = '', suffix = '' }) {
  let best = null;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    let score = 0;
    const before = text.slice(Math.max(0, at - prefix.length), at);
    for (let i = 1; i <= Math.min(before.length, prefix.length) && before.at(-i) === prefix.at(-i); i++) score += 1;
    const after = text.slice(at + quote.length, at + quote.length + suffix.length);
    for (let i = 0; i < Math.min(after.length, suffix.length) && after[i] === suffix[i]; i++) score += 1;
    if (!best || score > best.score) best = { start: at, end: at + quote.length, score };
  }
  return best;
}

// Wraps text start..end of a section in <mark>s (one per text node it crosses).
function wrap(index, start, end, attrs) {
  const made = [];
  for (const { node, start: s } of index.nodes) {
    const e = s + node.data.length;
    if (e <= start || s >= end || !node.data.length) continue;
    let target = node;
    const from = Math.max(start, s) - s;
    const to = Math.min(end, e) - s;
    if (to < target.data.length) target.splitText(to);
    if (from > 0) target = target.splitText(from);
    const mark = el('mark', attrs);
    target.parentNode.insertBefore(mark, target);
    mark.append(target);
    made.push(mark);
  }
  return made;
}

// Sets up marking on a drawn report. sections: [{ section_key, title, element (the .report-text), margin (the .report-margin) }].
export async function markReport({ report, sections, list, undoPlace }) {
  const bySection = new Map(sections.map((s) => [s.section_key, s]));
  const original = new Map(sections.map((s) => [s.section_key, s.element.innerHTML]));
  let marks = [];
  try { marks = await request('GET', `/api/reports/${report.report}/marks`); } catch { marks = []; }

  const pick = el('div', { class: 'report-pick', role: 'toolbar', 'aria-label': 'Mark these words', hidden: true });
  const pop = el('div', { class: 'report-pop', role: 'dialog', 'aria-label': 'Your comment', hidden: true });
  document.body.append(pick, pop);
  const closeAll = () => { pick.hidden = true; pop.hidden = true; pop.replaceChildren(); pop.classList.remove('report-pop-ask'); delete pop.dataset.mark; pop.setAttribute('aria-label', 'Your comment'); };

  const place = (box, rect) => {
    box.hidden = false;
    box.style.width = '';
    const width = box.offsetWidth;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    const top = rect.bottom + 8 + box.offsetHeight > window.innerHeight ? rect.top - box.offsetHeight - 8 : rect.bottom + 8;
    Object.assign(box.style, { left: `${left}px`, top: `${Math.min(Math.max(8, top), window.innerHeight - box.offsetHeight - 8)}px` });
  };
  // Questions and answers sit beside the words: on a wide screen over the comments column, level with them; else as above.
  const placeBeside = (box, node, section) => {
    const column = section?.margin.getBoundingClientRect();
    if (!node || !column?.width || getComputedStyle(section.margin).position === 'static') { place(box, (node ?? document.body).getBoundingClientRect()); return; }
    box.hidden = false;
    box.style.width = `${Math.max(320, column.width)}px`; // the column's own width
    const left = Math.min(column.left, window.innerWidth - box.offsetWidth - 8);
    const top = Math.min(Math.max(8, node.getBoundingClientRect().top - 8), window.innerHeight - box.offsetHeight - 8);
    Object.assign(box.style, { left: `${left}px`, top: `${Math.max(8, top)}px` });
  };
  const plain = (text) => String(text).replace(/[*_`#>]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Draw every mark: the section's text afresh, then each mark found in it; comments in the margin; the list at the top.
  function draw() {
    const missing = [];
    for (const s of sections) { s.element.innerHTML = original.get(s.section_key); s.margin.replaceChildren(); s.margin.hidden = true; }
    for (const m of marks) {
      const home = bySection.get(m.section_key);
      const tryIn = home ? [home, ...sections.filter((s) => s !== home)] : sections;
      let found = null;
      for (const s of tryIn) {
        const index = textIndex(s.element);
        const at = locate(index.text, m);
        const kind = ['report-mark', m.comment ? 'has-comment' : '', m.asks?.length ? 'has-ask' : ''].filter(Boolean).join(' ');
        if (at) { found = s; wrap(index, at.start, at.end, { class: kind, 'data-mark': m.id, tabindex: '0' }); break; }
      }
      if (!found) { missing.push(m); continue; }
      m.shown_in = found.section_key;
      const asked = (m.asks ?? []).filter((a) => a.role === 'user');
      const answer = (m.asks ?? []).findLast((a) => a.role === 'assistant' && a.text);
      if (m.comment || asked.length) {
        found.margin.hidden = false;
        found.margin.append(el('button', { type: 'button', class: asked.length ? 'report-margin-note is-ask' : 'report-margin-note', 'data-mark': m.id, onclick: () => show(m.id) },
          el('span', { class: 'report-margin-quote' }, `“${short(m.quote, 70)}”`),
          m.comment ? el('span', { class: 'report-margin-comment' }, m.comment) : null,
          asked.length ? el('span', { class: 'report-margin-asked' }, icon('assistant'), el('span', {}, asked.at(-1).text)) : null,
          answer ? el('span', { class: 'report-margin-answer' }, short(plain(answer.text), 220)) : null,
          asked.length > 1 ? el('span', { class: 'report-margin-more' }, `${asked.length} questions · open to read them all`) : null));
      }
    }
    drawList(missing);
    lineUp();
  }

  // On a wide screen each comment sits level with its words; when two would overlap, the lower one moves down just enough.
  function lineUp() {
    for (const s of sections) {
      const notes = [...s.margin.querySelectorAll('.report-margin-note')];
      s.margin.style.minHeight = '';
      if (!notes.length) continue;
      if (getComputedStyle(notes[0]).position !== 'absolute') { for (const n of notes) n.style.top = ''; continue; }
      const top = s.margin.getBoundingClientRect().top;
      const placed = notes.map((n) => ({ n, at: (s.element.querySelector(`mark[data-mark="${n.dataset.mark}"]`)?.getBoundingClientRect().top ?? top) - top }))
        .sort((a, b) => a.at - b.at);
      let next = 0;
      for (const p of placed) {
        const at = Math.max(p.at, next);
        p.n.style.top = `${at}px`;
        next = at + p.n.offsetHeight + 8;
      }
      s.margin.style.minHeight = `${next}px`;
    }
  }
  let resizing = 0;
  const onResize = () => { cancelAnimationFrame(resizing); resizing = requestAnimationFrame(lineUp); };
  window.addEventListener('resize', onResize);
  document.fonts?.ready.then(lineUp);

  function drawList(missing) {
    const shown = marks.filter((m) => !missing.includes(m));
    if (!marks.length) {
      list.replaceChildren(el('p', { class: 'report-my-empty' }, 'Select any words in the report to highlight them, add a comment or ask your assistant about them. Only you see them, and your assistant reads them with the report.'));
      return;
    }
    const row = (m, gone) => el('li', { class: gone ? 'report-my-item is-gone' : 'report-my-item' },
      el('button', { type: 'button', class: 'report-my-link', disabled: gone, onclick: () => show(m.id) },
        el('span', { class: 'report-my-where' }, gone ? 'No longer found in this version' : (bySection.get(m.shown_in)?.title ?? '')),
        el('span', { class: 'report-my-quote' }, `“${short(m.quote)}”`),
        m.comment ? el('span', { class: 'report-my-comment' }, m.comment) : null,
        m.asks?.some((a) => a.role === 'user') ? el('span', { class: 'report-my-comment' }, `You asked: ${m.asks.findLast((a) => a.role === 'user').text}`) : null),
      gone ? el('button', { type: 'button', class: 'button button-quiet', onclick: () => remove(m) }, 'Remove') : null);
    const count = `${marks.length} ${marks.length === 1 ? 'highlight' : 'highlights'}${marks.some((m) => m.comment) ? `, ${marks.filter((m) => m.comment).length} with a comment` : ''}`;
    list.replaceChildren(el('details', { class: 'report-my', open: list.dataset.open === 'yes' || undefined, ontoggle: (e) => { list.dataset.open = e.target.open ? 'yes' : 'no'; } },
      el('summary', {}, 'Your highlights', el('span', { class: 'report-my-count' }, ` · ${count}`)),
      el('ol', { class: 'report-my-list' }, ...shown.map((m) => row(m, false)), ...missing.map((m) => row(m, true)))));
  }

  // A mark brought into view and opened: its comment to read, change or add, and Remove.
  function show(id) {
    const node = document.querySelector(`mark[data-mark="${id}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => open(id), 350);
  }
  function open(id) {
    const m = marks.find((x) => x.id === id);
    const node = document.querySelector(`mark[data-mark="${id}"]`);
    if (!m || !node) return;
    if (m.conversation_id || m.asks?.length) { openThread(m); return; }
    pick.hidden = true;
    pop.classList.remove('report-pop-ask');
    pop.setAttribute('aria-label', 'Your comment');
    delete pop.dataset.mark;
    const box = el('textarea', { class: 'report-pop-text', rows: 3, placeholder: 'Your comment…', 'aria-label': 'Your comment', maxlength: 4000 });
    box.value = m.comment;
    pop.replaceChildren(
      el('p', { class: 'report-pop-quote' }, `“${short(m.quote, 120)}”`),
      box,
      el('div', { class: 'report-pop-actions' },
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => remove(m) }, icon('trash'), ' Remove highlight'),
        el('button', { type: 'button', class: 'button', onclick: async () => { await saveComment(m, box.value); closeAll(); } }, 'Save')));
    place(pop, node.getBoundingClientRect());
    box.focus();
  }

  async function saveComment(m, words) {
    if (words.trim() === m.comment) return;
    Object.assign(m, await request('PATCH', `/api/report-marks/${m.id}`, { comment: words }));
    draw();
  }
  async function remove(m) {
    closeAll();
    await request('DELETE', `/api/report-marks/${m.id}`);
    marks = marks.filter((x) => x !== m);
    draw();
    undoPlace.replaceChildren(undoBar('Highlight removed.', async () => {
      marks = [...marks, { ...(await request('POST', `/api/report-marks/${m.id}/restore`, {})), asks: m.asks ?? [] }].sort((a, b) => a.created_at.localeCompare(b.created_at));
      draw();
      undoPlace.replaceChildren();
    }));
  }

  // ---- Ask about this: a highlight's own chat with the assistant ----
  const sectionTitle = (m) => bySection.get(m.shown_in ?? m.section_key)?.title ?? '';
  let answering = null; // the mark whose answer is under way: one at a time

  // The pop for a mark's questions and answers: the words, each question and its answer, and a box to ask (more).
  function openThread(m, question = null) {
    pick.hidden = true;
    const thread = el('div', { class: 'report-ask-thread' });
    const box = el('textarea', { class: 'report-pop-text', rows: 2, maxlength: 20000, 'aria-label': 'Your question',
      placeholder: m.asks?.length ? 'Ask more about these words…' : 'Ask your assistant about these words…',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } });
    const askButton = el('button', { type: 'button', class: 'button', onclick: () => send() }, icon('assistant'), ' Ask');
    const drawThread = () => {
      thread.replaceChildren(...(m.asks ?? []).map((a) => {
        if (a.role === 'user') return el('p', { class: 'report-ask-q' }, a.text);
        const node = el('div', { class: 'report-ask-a' });
        if (a.text) node.innerHTML = markdown.render(a.text);
        else node.append(el('p', { class: 'report-ask-wait' }, a.state === 'answering' ? a.doing ?? 'Thinking…' : 'No answer came.'));
        return node;
      }));
      thread.hidden = !thread.childElementCount;
      askButton.disabled = Boolean(answering);
      if (!pop.hidden && pop.dataset.mark === m.id) { // a growing answer keeps the box on the screen
        const box = pop.getBoundingClientRect();
        if (box.bottom > window.innerHeight - 8) pop.style.top = `${Math.max(8, window.innerHeight - 8 - box.height)}px`;
      }
    };
    async function send() {
      const words = box.value.trim();
      if (!words || answering) return;
      box.value = '';
      await ask(m, words, drawThread);
    }
    pop.replaceChildren(...[
      el('p', { class: 'report-pop-quote' }, `“${short(m.quote, 120)}”`),
      m.comment ? el('p', { class: 'report-ask-comment' }, m.comment) : null,
      thread,
      box,
      el('div', { class: 'report-pop-actions' },
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => remove(m) }, icon('trash'), ' Remove'),
        m.conversation_id ? el('a', { class: 'button button-quiet', href: `/assistant/${m.conversation_id}` }, 'Open in Assistant') : null,
        askButton)].filter(Boolean));
    pop.classList.add('report-pop-ask');
    pop.setAttribute('aria-label', 'Ask your assistant');
    pop.dataset.mark = m.id;
    drawThread();
    placeBeside(pop, document.querySelector(`mark[data-mark="${m.id}"]`), bySection.get(m.shown_in ?? m.section_key));
    if (question) ask(m, question, drawThread); else box.focus();
  }

  // Asks the assistant about a mark's words; the answer streams into the pop (redraw) and, when done, into the margin.
  async function ask(m, words, redraw) {
    answering = m.id;
    m.asks = [...(m.asks ?? []), { role: 'user', text: words, state: 'done' }];
    const answer = { role: 'assistant', text: '', state: 'answering' };
    m.asks.push(answer);
    redraw();
    try {
      const res = await fetch(`/api/report-marks/${m.id}/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: words, report_title: report.title, section_title: sectionTitle(m) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The assistant could not answer.');
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === 'chat') m.conversation_id = event.conversation_id;
          else if (event.type === 'text') answer.text += event.text;
          else if (event.type === 'step') answer.doing = stepWords(event.step.tool);
          else if (event.type === 'done') Object.assign(answer, { text: event.message.text, state: event.message.state });
        }
        if (pop.dataset.mark === m.id) redraw();
      }
    } catch (err) {
      answer.text = err.message;
      answer.state = 'failed';
    }
    if (answer.state === 'answering') answer.state = 'done';
    answering = null;
    const open = !pop.hidden && pop.dataset.mark === m.id;
    draw();
    if (open) openThread(m);
  }

  function askNew() {
    if (!chosen) return;
    const rect = chosen.rect;
    const box = el('textarea', { class: 'report-pop-text', rows: 2, placeholder: 'Ask your assistant about these words…', 'aria-label': 'Your question', maxlength: 20000 });
    const go = async () => {
      const words = box.value.trim();
      if (!words) { box.focus(); return; }
      const made = await keep('', { close: false });
      if (made) openThread(marks.find((x) => x.id === made.id), words);
    };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    pick.hidden = true;
    pop.classList.add('report-pop-ask');
    pop.setAttribute('aria-label', 'Ask your assistant');
    delete pop.dataset.mark;
    pop.replaceChildren(
      el('p', { class: 'report-pop-quote' }, `“${short(chosen.quote, 120)}”`),
      box,
      el('div', { class: 'report-pop-actions' },
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => { chosen = null; closeAll(); } }, 'Cancel'),
        el('button', { type: 'button', class: 'button', onclick: go }, icon('assistant'), ' Ask')));
    place(pop, rect);
    box.focus();
  }

  // ---- Selecting words ----
  let chosen = null;
  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const section = sections.find((s) => s.element.contains(range.startContainer) && s.element.contains(range.endContainer));
    if (!section) return null;
    const index = textIndex(section.element);
    let start = offsetOf(section.element, range.startContainer, range.startOffset);
    let end = offsetOf(section.element, range.endContainer, range.endOffset);
    if (start == null || end == null || end <= start) return null;
    while (start < end && /\s/.test(index.text[start])) start += 1; // no spaces at the edges
    while (end > start && /\s/.test(index.text[end - 1])) end -= 1;
    const letter = (c) => c != null && /[\p{L}\p{N}’'-]/u.test(c); // whole words: a part-chosen word is taken whole
    while (start > 0 && letter(index.text[start - 1]) && letter(index.text[start])) start -= 1;
    while (end < index.text.length && letter(index.text[end]) && letter(index.text[end - 1])) end += 1;
    const quote = index.text.slice(start, end);
    if (!quote || quote.length > 2000) return null;
    return { section, quote, prefix: index.text.slice(Math.max(0, start - AROUND), start), suffix: index.text.slice(end, end + AROUND), rect: range.getBoundingClientRect() };
  }
  async function keep(comment = '', { close = true } = {}) {
    if (!chosen) return;
    const { section, quote, prefix, suffix } = chosen;
    const made = await request('POST', `/api/reports/${report.report}/marks`, { section_key: section.section_key, quote, prefix, suffix, comment, version: report.version });
    marks.push({ ...made, asks: [] });
    window.getSelection()?.removeAllRanges();
    chosen = null;
    if (close) closeAll();
    draw();
    return made;
  }
  function askComment() {
    if (!chosen) return;
    const rect = chosen.rect;
    const box = el('textarea', { class: 'report-pop-text', rows: 3, placeholder: 'Your comment…', 'aria-label': 'Your comment', maxlength: 4000 });
    pick.hidden = true;
    pop.classList.remove('report-pop-ask');
    pop.setAttribute('aria-label', 'Your comment');
    delete pop.dataset.mark;
    pop.replaceChildren(
      el('p', { class: 'report-pop-quote' }, `“${short(chosen.quote, 120)}”`),
      box,
      el('div', { class: 'report-pop-actions' },
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => { chosen = null; closeAll(); } }, 'Cancel'),
        el('button', { type: 'button', class: 'button', onclick: () => keep(box.value) }, 'Save comment')));
    place(pop, rect);
    box.focus();
  }
  pick.append(
    el('button', { type: 'button', class: 'button button-quiet', onmousedown: (e) => e.preventDefault(), onclick: () => keep('') }, 'Highlight'),
    el('button', { type: 'button', class: 'button button-quiet', onmousedown: (e) => e.preventDefault(), onclick: askComment }, 'Comment'),
    el('button', { type: 'button', class: 'button button-quiet report-pick-ask', onmousedown: (e) => e.preventDefault(), onclick: askNew }, icon('assistant'), 'Ask about this'),
    // Tell Daniel (2026-11-19, the owner's wish): a problem or a question about these words, with the report and section.
    ...(moduleOn('tell') ? [el('button', { type: 'button', class: 'button button-quiet tell-daniel', onmousedown: (e) => e.preventDefault(), onclick: () => {
      if (!chosen) return;
      const { section, quote } = chosen;
      pick.hidden = true;
      openTellDaniel({ place: 'report', items: [
        { key: 'report', label: 'Report', value: `${report.title}${report.version ? ` (version ${report.version})` : ''}` },
        { key: 'section', label: 'Section', value: section.title ?? section.section_key },
        { key: 'quote', label: 'The words', value: quote.slice(0, 6000) }] });
    } }, 'Tell Daniel')] : []));

  const onSelectEnd = () => setTimeout(() => {
    if (!pop.hidden) return;
    chosen = selectionInfo();
    if (chosen) place(pick, chosen.rect); else pick.hidden = true;
  }, 10);
  const onClick = (event) => {
    const mark = event.target.closest?.('mark.report-mark');
    if (mark && window.getSelection()?.isCollapsed) { open(mark.dataset.mark); return; }
    if (!pick.contains(event.target) && !pop.contains(event.target) && !event.target.closest?.('.report-margin-note, .report-my-link')) {
      if (!pop.hidden) closeAll();
    }
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && (!pop.hidden || !pick.hidden)) { closeAll(); return; }
    if (event.key === 'Enter' && event.target.matches?.('mark.report-mark')) open(event.target.dataset.mark);
  };
  const body = sections[0]?.element.closest('.report-body') ?? document;
  body.addEventListener('mouseup', onSelectEnd);
  body.addEventListener('touchend', onSelectEnd);
  body.addEventListener('keyup', (e) => { if (e.shiftKey) onSelectEnd(); });
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  draw();
  // Leaving the page takes the floating boxes and the listeners with it.
  return () => { pick.remove(); pop.remove(); window.removeEventListener('resize', onResize); document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
}
