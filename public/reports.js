// Reports (module reports, 2026-11-16, the owner's wish): your own Sovran reports to read.
//   /reports           every report: the Layered Portrait first, then the newest; each with its sections (downloads are inside)
//   /reports/:report   one report to read, section by section, with its contents at the top and its downloads
// The server is reports.js (GET /api/reports, /api/reports/:report, /api/reports/:report/files/:kind). A report's text is
// Markdown, drawn with markdown-it (no HTML inside it is ever drawn). They come from the Sovran Library with your key.

import markdownit from '/vendor/markdown-it/index.mjs';
import { el, icon, request } from './ui.js';
import { app, screen, onLeave } from './shell.js';
import { markReport } from './report-marks.js';

const markdown = markdownit({ html: false, linkify: true });
const FILE_WORDS = { pdf: 'Download the PDF', 'for-your-ai': 'Download the file for your AI' };

const dayWords = (day) => (day ? new Date(`${String(day).slice(0, 10)}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const metaLine = (r) => [
  `Version ${r.version}`,
  r.approved_on ? dayWords(r.approved_on) : '',
  r.words ? `${Number(r.words).toLocaleString()} words` : '',
].filter(Boolean).join(' · ');

const downloads = (r) => (r.files.length
  ? el('div', { class: 'report-files' }, ...r.files.map((f) => el('a', {
    class: 'button button-quiet report-file', href: `/api/reports/${r.report}/files/${f.kind}`, download: f.file_name, 'data-kind': f.kind,
  }, icon('down'), ` ${FILE_WORDS[f.kind] ?? f.file_name}`)))
  : null);

function reportCard(r) {
  return el('article', { class: 'report-card', 'data-report': r.report },
    el('a', { class: 'report-card-main', href: `/reports/${r.report}` },
      el('span', { class: 'report-card-shape', 'aria-hidden': 'true' }, icon('report')),
      el('span', { class: 'report-card-text' },
        el('h2', { class: 'report-card-title' }, r.title),
        el('span', { class: 'report-card-meta' }, metaLine(r)),
        r.sections.length ? el('span', { class: 'report-card-sections' }, r.sections.map((s) => s.title).join(' · ')) : null)));
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
  const portrait = reports.some((r) => r.report === 'layered-portrait') ? null
    : el('p', { class: 'report-portrait-waiting' }, el('span', { class: 'report-portrait-title' }, 'Your Layered Portrait'),
      ' begins here and grows as you go through the Sovran Quest.');
  screen.replaceChildren(top,
    el('p', { class: 'report-intro' }, 'Your own Sovran reports, to read here or download.'),
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
  // Each section: its text, and beside it (under it on a phone) the margin with your comments (public/report-marks.js).
  const parts = r.sections.map((s) => {
    const text = el('div', { class: 'report-text' });
    text.innerHTML = markdown.render(s.body ?? '');
    const margin = el('aside', { class: 'report-margin', 'aria-label': `Your comments on ${s.title}`, hidden: true });
    return { section_key: s.section_key, title: s.title, element: text, margin,
      node: el('section', { class: `report-section report-level-${s.level ?? 1}`, id: anchor(s), 'data-section': s.section_key },
        el(s.level === 2 ? 'h3' : 'h2', { class: 'report-section-title' }, s.title),
        el('div', { class: 'report-section-row' }, text, margin)) };
  });
  const body = el('div', { class: 'report-body' }, ...parts.map((p) => p.node));
  const list = el('div', { class: 'report-my-place' });
  const undoPlace = el('div', { class: 'report-undo' });
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, back),
    el('div', { class: 'report-head' },
      el('h1', { class: 'top-bar-title report-title' }, r.title),
      el('p', { class: 'report-meta' }, metaLine(r)),
      downloads(r)),
    ...(contents ? [contents] : []),
    list,
    body,
    undoPlace);
  const finish = await markReport({ report: r, sections: parts, list, undoPlace });
  onLeave(finish);
}
