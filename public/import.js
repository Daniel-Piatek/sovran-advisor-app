// Bring your contacts in (People in depth, advanced/people/6): Import in People opens a box. You
// choose a .vcf (a phone's vCard) or a .csv (a mail program's export); the page reads the file
// (it is never changed or sent anywhere but this app), the app says what an import would do
// (how many are new, how many are here already), and Import does it. Safe to run twice: nobody
// is added twice, and whoever is here already is left exactly as you wrote them.

import { el, icon, request } from './ui.js';

let dialog = null;

// Photos in a vCard are long lines nobody needs here: leave them out before sending.
const withoutPhotos = (text) => text.replace(/^(?:[A-Za-z0-9-]+\.)?(?:PHOTO|LOGO)[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*\r?\n?/gim, '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function previewWords(r) {
  return [`${plural(r.read, 'contact', 'contacts')} read`, `${r.added} new`, `${r.matched} here already`,
    ...(r.companies_made ? [plural(r.companies_made, 'company', 'companies') + ' to make'] : []),
    ...(r.skipped ? [`${r.skipped} without a name left out`] : [])].join(' · ');
}
export function doneWords(r) {
  return `Added ${plural(r.added, 'person', 'people')}${r.companies_made ? ` and ${plural(r.companies_made, 'company', 'companies')}` : ''}. ${r.matched} ${r.matched === 1 ? 'was' : 'were'} here already${r.skipped ? `, ${r.skipped} without a name left out` : ''}.`;
}

// onDone() runs after an import added someone (People draws its list again).
export function openImport({ onDone = () => {} } = {}) {
  dialog?.remove();
  let text = '';
  let filename = '';
  let imported = false;
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const report = el('p', { class: 'import-report', role: 'status' });
  const names = el('p', { class: 'capture-hint' });
  const run = el('button', { type: 'button', class: 'button button-primary', disabled: true, onclick: () => go() }, 'Import');
  const close = () => { dialog.close(); if (imported) onDone(); };
  const file = el('input', {
    type: 'file', class: 'import-file', accept: '.vcf,.csv,text/vcard,text/csv,text/plain', 'aria-label': 'Choose a file',
    onchange: async () => {
      const chosen = file.files?.[0];
      problem.textContent = '';
      report.textContent = '';
      names.textContent = '';
      run.disabled = true;
      imported = false;
      if (!chosen) return;
      filename = chosen.name;
      text = withoutPhotos(await chosen.text());
      try {
        const r = await request('POST', '/api/import/contacts', { filename, text, dry_run: true });
        report.textContent = r.added || r.matched ? previewWords(r) : 'Nobody to read in that file.';
        names.textContent = r.names.length ? `New: ${r.names.join(', ')}${r.added > r.names.length ? '…' : ''}` : '';
        run.disabled = r.added === 0;
        if (r.added === 0 && r.matched) report.textContent += ' · nothing new to add.';
      } catch (err) { problem.textContent = err.message; }
    },
  });

  async function go() {
    run.disabled = true;
    try {
      const r = await request('POST', '/api/import/contacts', { filename, text });
      report.textContent = doneWords(r);
      names.textContent = 'Run it again any time: nobody is added twice.';
      imported = r.added > 0;
      file.value = '';
      text = '';
    } catch (err) { problem.textContent = err.message; run.disabled = false; }
  }

  dialog = el('dialog', { class: 'capture-box import-box', 'aria-label': 'Import contacts' },
    el('h2', { class: 'settings-title' }, 'Import contacts'),
    el('p', { class: 'capture-hint' }, 'A .vcf from your phone or a .csv from Google Contacts. Your file is read, never changed; whoever is here already stays as you wrote them.'),
    el('label', { class: 'button import-choose' }, icon('plus'), 'Choose a file', file),
    report, names, problem,
    el('div', { class: 'capture-foot' }, run, el('button', { type: 'button', class: 'button button-quiet', onclick: close }, 'Close')));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
}
