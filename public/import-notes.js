// Settings › Import (advanced/writing/9): an Obsidian folder and a Day One export, read by the page and sent as text. The report of each run
// says how many came in, were already here, were kept because you edited them, and that none were doubled.

import { el, request, timeAgo } from './ui.js';

const kindWord = { obsidian: 'Obsidian folder', dayone: 'Day One export' };

// One report. Used by the library too.
export function importReport(run) {
  const rows = run.kind === 'obsidian'
    ? [['Imported', run.imported], ['Already here', run.already], ['Doubled', run.doubled], ['Kept (you edited them)', run.kept]]
    : [['Entries added', run.added], ['Already here', run.already], ['Doubled', run.doubled], ['Days covered', run.days]];
  return el('article', { class: 'import-report', 'data-kind': run.kind, 'aria-label': `Import report: ${kindWord[run.kind]}` },
    el('h3', { class: 'import-report-title' }, `${kindWord[run.kind]}${run.source ? ` · ${run.source}` : ''}`, el('span', { class: 'import-report-when' }, ` · ${run.created_at ? timeAgo(run.created_at) : 'now'}`)),
    el('dl', { class: 'import-report-counts' }, ...rows.flatMap(([name, n]) => [el('dt', {}, name), el('dd', {}, String(n))])),
    ...(run.kept_titles?.length ? [el('p', { class: 'import-report-note' }, `Left as you wrote them: ${run.kept_titles.join(', ')}.`)] : []),
    ...(run.kind === 'dayone' && run.first ? [el('p', { class: 'import-report-note' }, `From ${run.first} to ${run.last}.`)] : []));
}

export function importSection() {
  const reports = el('div', { class: 'import-reports', 'aria-live': 'polite' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const status = el('p', { class: 'empty', role: 'status' });
  const draw = (runs) => reports.replaceChildren(...(runs.length ? runs.map(importReport) : [el('p', { class: 'empty' }, 'Nothing imported yet.')]));
  const load = () => request('GET', '/api/import/runs').then(draw).catch(() => {});
  const folder = el('input', { type: 'file', webkitdirectory: '', directory: '', multiple: '', hidden: true, 'aria-label': 'Choose an Obsidian folder' });
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Choose a Day One export' });

  folder.addEventListener('change', async () => {
    problem.textContent = '';
    const picked = [...folder.files].filter((f) => /\.md$/i.test(f.name));
    if (!picked.length) { status.textContent = 'There are no Markdown files in that folder.'; return; }
    status.textContent = `Reading ${picked.length} notes…`;
    try {
      const files = await Promise.all(picked.map(async (f) => ({ path: f.webkitRelativePath || f.name, text: await f.text() })));
      const root = (files[0].path.split('/')[0]) || '';
      await request('POST', '/api/import/obsidian', { files, source: root });
      status.textContent = '';
      await load();
    } catch (err) { status.textContent = ''; problem.textContent = err.message; }
    folder.value = '';
  });
  file.addEventListener('change', async () => {
    problem.textContent = '';
    const picked = file.files[0];
    if (!picked) return;
    status.textContent = 'Reading the export…';
    try {
      await request('POST', '/api/import/dayone', { json: await picked.text(), source: picked.name });
      status.textContent = '';
      await load();
    } catch (err) { status.textContent = ''; problem.textContent = err.message; }
    file.value = '';
  });

  void load();
  return el('section', { class: 'settings-part', 'aria-label': 'Import' },
    el('h2', { class: 'settings-title' }, 'Import'),
    el('p', { class: 'empty' }, 'Bring in what you already have. The files are only read, never changed; running an import again adds nothing twice; a note you edited after it came in is left as you wrote it.'),
    el('div', { class: 'import-buttons' },
      el('button', { type: 'button', class: 'button', onclick: () => folder.click() }, 'Choose folder (Obsidian)'),
      el('button', { type: 'button', class: 'button', onclick: () => file.click() }, 'Choose file (Day One)'), folder, file),
    status, problem, reports);
}
