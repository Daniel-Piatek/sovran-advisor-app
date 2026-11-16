// The Files box at the bottom of the task pop-up (task-files.js on the server): PDFs, screenshots, pictures and any
// other file that belongs to a task. Each file is kept on this computer, in the app's data folder, like a picture
// pasted into a note. Add file (or drop files on the box) puts one on the task; a click on its name opens it;
// Remove from this task takes it off (the file itself stays kept).

import { api, el, request } from './ui.js';

const sizeOf = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function taskFilesSection(taskId) {
  const heading = el('h2', { class: 'task-files-title' }, 'Files');
  const list = el('div', { class: 'task-files-list' });
  const note = el('p', { class: 'task-files-note', hidden: true });
  const picker = el('input', { type: 'file', multiple: true, hidden: true, 'aria-label': 'Choose files to add' });
  const addButton = el('button', { type: 'button', class: 'button' }, 'Add file');
  const section = el('section', { class: 'task-files', 'aria-label': 'Files' }, heading, list, note,
    el('div', { class: 'task-files-actions' }, addButton, el('span', { class: 'task-files-hint' }, 'or drop files here')), picker);
  const say = (text) => { note.textContent = text; note.hidden = !text; };

  function row(file) {
    const remove = el('button', { type: 'button', class: 'button task-file-small' }, 'Remove from this task');
    remove.addEventListener('click', async () => {
      try { await request('DELETE', `/api/task-files/${file.id}`); load(); } catch (err) { say(err.message); }
    });
    return el('div', { class: 'task-file' },
      el('a', { class: 'task-file-name', href: file.url, target: '_blank', rel: 'noopener' }, file.name),
      el('span', { class: 'task-file-size' }, sizeOf(file.size)),
      remove);
  }

  function show(files) {
    heading.textContent = files.length ? `Files · ${files.length}` : 'Files';
    list.replaceChildren(...(files.length ? files.map(row) : [el('p', { class: 'task-files-empty' }, 'No files yet.')]));
  }

  async function load() {
    try { show(await request('GET', `/api/tasks/${taskId}/files`)); } catch (err) { say(err.message); }
  }

  async function add(files) {
    say('');
    for (const file of files) {
      try {
        const kept = await api.uploadFile(file);
        show(await request('POST', `/api/tasks/${taskId}/files`, { sha256: kept.sha256 }));
      } catch (err) { say(`${file.name}: ${err.message}`); }
    }
  }

  addButton.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => { const chosen = [...picker.files]; picker.value = ''; add(chosen); });
  section.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); section.classList.add('task-files-drop'); } });
  section.addEventListener('dragleave', () => section.classList.remove('task-files-drop'));
  section.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    section.classList.remove('task-files-drop');
    add([...event.dataTransfer.files]);
  });
  load();
  return section;
}
