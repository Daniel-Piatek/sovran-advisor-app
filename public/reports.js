// Reports (module reports, 2026-11-16, the owner's wish): your own Sovran reports to read.
//   /reports           every report: the Layered Portrait first, then the newest; each with its sections (downloads are inside)
//   /reports/:report   one report to read, section by section, with its contents at the top and its downloads
// A report reads in its own Ivory & Gold look (2026-11-16, the owner's wish, from the Sovran Machine's machine/styles/report.css):
// a warm ivory page, a cover at the top (the crimson crown, the title in Gloock, a gold double rule, the Live Sovran wordmark),
// gold PART labels, a crimson drop cap on each part's first paragraph, and one small, quiet PDF download (the white print PDF; the file for your AI is not offered, the owner's wish).
// The server is reports.js (GET /api/reports, /api/reports/:report, /api/reports/:report/files/:kind). A report's text is
// Markdown, drawn with markdown-it (no HTML inside it is ever drawn). They come from the Sovran Library with your key.

import markdownit from '/vendor/markdown-it/index.mjs';
import { el, icon, request } from './ui.js';
import { app, screen, onLeave } from './shell.js';
import { markReport } from './report-marks.js';

const markdown = markdownit({ html: false, linkify: true });
const PART_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

const dayWords = (day) => (day ? new Date(`${String(day).slice(0, 10)}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const metaLine = (r) => [
  `Version ${r.version}`,
  r.approved_on ? dayWords(r.approved_on) : '',
  r.words ? `${Number(r.words).toLocaleString()} words` : '',
].filter(Boolean).join(' · ');

// Only the white PDF is offered, as one small quiet link: reading here comes first (the owner's wish, 2026-11-16).
const downloads = (r) => {
  const pdf = r.files.find((f) => f.kind === 'pdf');
  return pdf ? el('div', { class: 'report-files' }, el('a', {
    class: 'report-file', href: `/api/reports/${r.report}/files/pdf`, download: pdf.file_name, 'data-kind': 'pdf',
  }, icon('down'), ' PDF download')) : null;
};

// What each kind of report is, for its card (the owner's wish, 2026-11-16: a description, not the list of sections).
const ABOUT = [
  [/pattern/i, 'Rooted in your own design, your Pattern shows your natural gifts and your challenges as one whole: you are the Sovran Self, already whole, perfect and complete, with nothing to fix. It opens a way of living from that wholeness, meeting every part of yourself as it is and following the knowing that has always been inside you.'],
  [/layered-portrait|portrait/i, 'One page that grows with you: each part of the Sovran Quest adds a layer.'],
];
const aboutOf = (r) => r.description || ABOUT.find(([match]) => match.test(`${r.report} ${r.title}`))?.[1] || '';
// A report's own picture for its card, when it has one (the Pattern's, the owner's, 2026-11-16); else the crown.
const PICTURES = [[/pattern/i, '/brand/sovran-pattern-report.png']];
const pictureOf = (r) => PICTURES.find(([match]) => match.test(`${r.report} ${r.title}`))?.[1];

// A report's card, in the report's own Ivory & Gold look: crown, gold label and rule, title, what it is, and when.
function reportCard(r) {
  const about = aboutOf(r);
  return el('article', { class: 'report-card', 'data-report': r.report },
    el('a', { class: 'report-card-main', href: `/reports/${r.report}` },
      pictureOf(r) ? el('img', { class: 'report-card-picture', src: pictureOf(r), alt: '' })
        : el('img', { class: 'report-card-crown', src: '/brand/official-crimson-crown.png', alt: '' }),
      el('span', { class: 'report-card-text' },
        el('span', { class: 'report-card-label' }, 'Sovran report'),
        el('h2', { class: 'report-card-title' }, r.title),
        el('span', { class: 'report-card-rule', 'aria-hidden': 'true' }),
        about ? el('span', { class: 'report-card-about' }, about) : null,
        el('span', { class: 'report-card-meta' }, metaLine(r)),
        el('span', { class: 'report-card-open' }, 'Read it here', icon('right')))));
}

export async function showReports(name) {
  app.className = 'page reports-page';
  if (name) return showReport(name);
  document.title = 'Reports';
  let reports;
  let problem = '';
  try { reports = await request('GET', '/api/reports'); } catch (err) { reports = null; problem = err.message; }
  const top = el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Reports'));
  if (!reports) { screen.replaceChildren(top, el('p', { class: 'empty' }, problem || 'Your reports could not be read just now.')); return; }
  // The line under the title: where the Layered Portrait will be, until it is here (the owner's wish, 2026-11-16).
  const portrait = reports.some((r) => r.report === 'layered-portrait') ? null
    : el('p', { class: 'report-intro' }, el('span', { class: 'report-portrait-title' }, 'Your Layered Portrait'),
      ' begins here and grows as you go through the Sovran Quest.');
  screen.replaceChildren(top,
    portrait,
    reports.length ? el('div', { class: 'report-list' }, ...reports.map(reportCard))
      : el('p', { class: 'empty' }, 'No reports yet. Each one appears here once it is ready.'));
}

async function showReport(name) {
  let r;
  let problem = '';
  try { r = await request('GET', `/api/reports/${encodeURIComponent(name)}`); } catch (err) { r = null; problem = err.status === 404 ? '' : err.message; }
  const back = el('a', { class: 'back-link', href: '/reports' }, icon('back'), ' Reports');
  if (!r) {
    document.title = 'Reports';
    screen.replaceChildren(el('header', { class: 'top-bar' }, back), el('p', { class: 'empty' }, problem || 'There is no such report.'));
    return;
  }
  document.title = r.title;
  app.className = 'page page-wide reports-page report-reading';
  const anchor = (s) => `section-${s.section_key}`;
  const main = r.sections.filter((s) => (s.level ?? 1) === 1);
  const contents = main.length > 1 ? el('nav', { class: 'report-contents', 'aria-label': 'Contents' },
    el('h2', { class: 'report-contents-title' }, 'Contents'),
    el('ol', {}, ...main.map((s) => el('li', {}, el('button', {
      type: 'button', class: 'report-contents-link',
      onclick: () => document.getElementById(anchor(s))?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }, s.title))))) : null;
  // The parts: the first main section is the opening (Before You Begin, no label); the ones after it are Part One, Two, …
  const partOf = new Map(main.slice(main.length > 1 ? 1 : main.length).map((s, i) => [s.section_key, PART_WORDS[i] ?? String(i + 1)]));
  // Each section: its text, and beside it (under it on a phone) the margin with your comments (public/report-marks.js).
  const parts = r.sections.map((s) => {
    const text = el('div', { class: 'report-text' });
    text.innerHTML = markdown.render(s.body ?? '');
    const part = partOf.get(s.section_key);
    if (part) text.querySelector(':scope > p')?.classList.add('report-lede'); // the drop cap
    const margin = el('aside', { class: 'report-margin', 'aria-label': `Your comments on ${s.title}`, hidden: true });
    return { section_key: s.section_key, title: s.title, element: text, margin,
      node: el('section', { class: `report-section report-level-${s.level ?? 1}`, id: anchor(s), 'data-section': s.section_key },
        part ? el('p', { class: 'report-part-label' }, `Part ${part}`) : null,
        el(s.level === 2 ? 'h3' : 'h2', { class: 'report-section-title' }, s.title),
        el('div', { class: 'report-section-row' }, text, margin)) };
  });
  const body = el('div', { class: 'report-body' }, ...parts.map((p) => p.node));
  const list = el('div', { class: 'report-my-place' });
  const undoPlace = el('div', { class: 'report-undo' });
  // The top, like the report's cover: crown, title, gold lines, wordmark, and who it was prepared for when the report says.
  const cover = el('header', { class: 'report-cover' },
    el('img', { class: 'report-crown', src: '/brand/official-crimson-crown.png', alt: '' }),
    el('h1', { class: 'report-title' }, r.title),
    el('div', { class: 'report-rule', 'aria-hidden': 'true' }),
    el('img', { class: 'report-wordmark', src: '/brand/official-wordmark.png', alt: 'Live Sovran' }),
    r.prepared_for ? el('div', { class: 'report-for' }, el('p', { class: 'report-for-label' }, 'Prepared for'), el('p', { class: 'report-for-name' }, r.prepared_for)) : null,
    el('p', { class: 'report-meta' }, metaLine(r)),
    downloads(r));
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, back),
    el('article', { class: 'report-paper' },
      cover,
      el('div', { class: 'report-comments-head' }, el('p', { class: 'report-comments-title' }, 'Your comments'),
        el('p', { class: 'report-comments-hint' }, 'Select any words in the report to highlight them or add a comment. Your comments show here, level with their words.')),
      ...(contents ? [contents] : []),
      list,
      body),
    undoPlace);
  const finish = await markReport({ report: r, sections: parts, list, undoPlace });
  onLeave(finish);
}
