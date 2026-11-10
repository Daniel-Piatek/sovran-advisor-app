// People and companies (pkm/2):
//   /people             everyone, by name (n adds a person)
//   /companies          every company
//   /people/:id         a person: card, details, your notes about them, what mentions them
//   /companies/:id      a company: card, website, notes, its people, what mentions it
// A person is told from a company by shape: initials in a circle, or in a square.

import { createEditor, catchPageDrops, showTaskAt } from './editor.js';
import { api, el, icon, request, makeSaver, undoBar, linkedFromSection } from './ui.js';
import { createTimeline } from './timeline.js';
import { logLine } from './log-line.js';
import { cadenceChip, reconnectSection } from './cadence.js';
import { openImport } from './import.js';
import { duplicatesSection } from './merge.js';
import { moduleOn } from './modules.js';
import { app, screen, navigate, onLeave, setFlash, takeFlash, setFooterLink, recentlyDeletedLink } from './shell.js';

export const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('') || '?';

// The person card's face: initials in a circle (a person) or a square (a company).
export function face(kind, name, size = 'small') {
  return el('span', { class: `face face-${kind} face-${size}`, 'aria-hidden': 'true' }, kind === 'company' ? (name.trim()[0] ?? '?').toUpperCase() : initials(name));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---- The lists ----

export async function showPeople(kind = 'person') {
  const isPeople = kind === 'person';
  document.title = isPeople ? 'People' : 'Companies';
  let items = [];
  let query = new URLSearchParams(location.search).get('q') ?? '';

  const list = el('div', { class: 'people-list' });
  const search = el('input', {
    type: 'search', class: 'search-input', placeholder: isPeople ? 'Search people' : 'Search companies',
    'aria-label': isPeople ? 'Search people' : 'Search companies', autocomplete: 'off',
    oninput: () => { query = search.value; load(); },
  });
  search.value = query;
  const tabs = el('div', { class: 'journal-filters', role: 'group', 'aria-label': 'Show' },
    el('a', { class: 'chip', href: '/people', 'aria-pressed': String(isPeople) }, 'People'),
    el('a', { class: 'chip', href: '/companies', 'aria-pressed': String(!isPeople) }, 'Companies'));

  // Adding: a name, then Enter; the new page opens.
  const adding = el('div', { class: 'people-adding' });
  function startAdding() {
    const name = el('input', {
      class: 'search-input', placeholder: isPeople ? 'Name, e.g. Lena Fischer' : 'Name, e.g. Nordlicht Studio',
      'aria-label': isPeople ? 'New person’s name' : 'New company’s name', maxlength: 200,
      onkeydown: async (event) => {
        if (event.key === 'Escape') { adding.replaceChildren(); return; }
        if (event.key !== 'Enter' || !name.value.trim()) return;
        try {
          const made = isPeople ? await api.createPerson({ name: name.value }) : await api.createCompany({ name: name.value });
          await navigate(isPeople ? `/people/${made.id}` : `/companies/${made.id}`);
        } catch (err) {
          message.textContent = err.message;
        }
      },
    });
    const message = el('span', { class: 'journal-tools-message', role: 'alert' });
    adding.replaceChildren(el('label', { class: 'search' }, icon('plus'), name),
      el('span', { class: 'capture-hint' }, 'Enter adds · Esc cancels'), message);
    name.focus();
  }
  const newButton = el('button', { type: 'button', class: 'button button-primary page-add', onclick: startAdding },
    icon('plus'), isPeople ? 'New person' : 'New company');

  // n adds one, while not typing somewhere.
  const onKey = (event) => {
    if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, [contenteditable="true"], dialog')) return;
    event.preventDefault();
    startAdding();
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));

  const deleted = takeFlash();
  app.className = 'page page-wide';
  // With People in depth on, the people who are due come first: Reconnect.
  const reconnectPlace = el('div', {});
  const duplicatesPlace = el('div', {});
  if (isPeople && moduleOn('people-plus')) {
    reconnectSection().then((section) => reconnectPlace.replaceChildren(section));
    duplicatesSection({ onChanged: () => { load(); reconnectSection().then((section) => reconnectPlace.replaceChildren(section)); } }).then((section) => duplicatesPlace.replaceChildren(section));
  }
  screen.replaceChildren(
    el('header', { class: 'top-bar' },
      el('h1', { class: 'top-bar-title' }, isPeople ? 'People' : 'Companies'),
      newButton,
      el('label', { class: 'search' }, icon('search'), search),
      ...(isPeople && moduleOn('people-plus') ? [el('button', { type: 'button', class: 'button', onclick: () => openImport({ onDone: () => navigate('/people', { replace: true }) }) }, 'Import')] : [])),
    tabs,
    adding,
    duplicatesPlace,
    reconnectPlace,
    ...(isPeople && moduleOn('people-plus') ? [el('h2', { class: 'contact-heading' }, 'Everyone')] : []),
    list,
    ...(deleted && (deleted.kind === 'person' || deleted.kind === 'company')
      ? [undoBar(`“${deleted.name}” deleted.`, async () => {
        await (deleted.kind === 'person' ? api.restorePerson(deleted.id) : api.restoreCompany(deleted.id));
        await load();
      })]
      : []),
  );
  setFooterLink(recentlyDeletedLink());

  let run = 0;
  async function load() {
    const mine = ++run;
    history.replaceState(null, '', `${isPeople ? '/people' : '/companies'}${query.trim() ? `?q=${encodeURIComponent(query)}` : ''}`);
    try {
      const found = isPeople ? await api.listPeople(query) : await api.listCompanies(query);
      if (mine !== run) return;
      items = found;
    } catch {
      list.replaceChildren(el('p', { class: 'empty' }, "These couldn't be loaded. Is the app still running?"));
      return;
    }
    if (!items.length) {
      list.replaceChildren(el('p', { class: 'empty' }, query.trim()
        ? `Nobody matches “${query.trim()}”.`
        : isPeople ? 'No people yet. Press n or New person to add someone.' : 'No companies yet. Press n or New company to add one.'));
      return;
    }
    list.replaceChildren(...items.map((item) => el('a', {
      class: 'person-row', href: isPeople ? `/people/${item.id}` : `/companies/${item.id}`,
    },
    face(kind, item.name),
    el('span', { class: 'person-row-text' },
      el('span', { class: 'person-row-name' }, item.name),
      el('span', { class: 'person-row-sub' }, isPeople
        ? [item.role, item.company_name].filter(Boolean).join(' · ') || 'No company'
        : plural(item.people_count, 'person', 'people'))),
    el('span', { class: 'person-row-count' }, item.mention_count ? plural(item.mention_count, 'mention', 'mentions') : ''))));
  }
  await load();
}

// ---- One person, or one company ----

// A labelled field of the details, saved as you type. Several-line fields take one
// email or phone number per line.
function field(label, value, onInput, { lines = false, placeholder = '' } = {}) {
  const input = el(lines ? 'textarea' : 'input', {
    class: lines ? 'detail-input detail-lines' : 'detail-input', 'aria-label': label, placeholder,
    rows: lines ? 2 : false, oninput: () => onInput(input.value),
  });
  input.value = value;
  return [el('label', { class: 'detail-label' }, label), input];
}

export async function showContact(kind, id) {
  const isPerson = kind === 'person';
  const listHref = isPerson ? '/people' : '/companies';
  const status = el('span', { class: 'save-status', role: 'status' });
  const actions = el('div', { class: 'note-bar-actions' }, status);
  app.className = 'page';
  screen.replaceChildren(el('header', { class: 'note-bar' },
    el('a', { class: 'back-link', href: listHref, 'aria-label': isPerson ? 'Back to People' : 'Back to Companies' },
      icon('back'), isPerson ? 'People' : 'Companies'),
    actions));

  let item;
  try {
    item = isPerson ? await api.getPerson(id) : await api.getCompany(id);
  } catch (err) {
    document.title = isPerson ? 'People' : 'Companies';
    screen.append(el('p', { class: 'empty' }, err.status === 404
      ? `This ${isPerson ? 'person' : 'company'} doesn't exist, or was deleted. Recently deleted can bring them back.`
      : "This page couldn't be loaded. Is the app still running?"));
    return;
  }
  document.title = item.name;

  const saver = makeSaver((changes, options) => (isPerson ? api.updatePerson(id, changes, options) : api.updateCompany(id, changes, options)), { status });

  const deleteButton = el('button', {
    type: 'button', class: 'button button-quiet',
    onclick: async () => {
      deleteButton.disabled = true;
      try {
        if (!(await saver.settled())) throw new Error('not saved');
        setFlash({ kind, ...(await (isPerson ? api.deletePerson(id) : api.deleteCompany(id))) });
        await navigate(listHref);
      } catch {
        deleteButton.disabled = false;
        status.textContent = "Couldn't delete. Is the app still running?";
      }
    },
  }, icon('trash'), 'Delete');
  actions.append(deleteButton);

  // The person card: face, name (to type in), and who they are.
  const bigFace = face(kind, item.name, 'large');
  const name = el('input', {
    class: 'contact-name', 'aria-label': 'Name', value: item.name, maxlength: 200,
    oninput: () => {
      if (!name.value.trim()) return; // a name is needed: an empty one is not saved
      bigFace.textContent = isPerson ? initials(name.value) : name.value.trim()[0].toUpperCase();
      document.title = name.value;
      saver.change('name', name.value);
    },
  });
  name.value = item.name;
  const sub = el('p', { class: 'contact-sub' });
  const drawSub = () => {
    const companyName = companies.find((c) => c.id === item.company_id)?.name ?? item.company_name;
    sub.replaceChildren(...(isPerson
      ? [item.role, item.company_id && companyName ? el('a', { href: `/companies/${item.company_id}` }, companyName) : null]
        .filter(Boolean).flatMap((part, i) => (i ? [' · ', part] : [part]))
      : [plural(item.people.length, 'person', 'people')]));
  };

  // The details.
  let companies = [];
  const details = el('div', { class: 'contact-details' });
  if (isPerson) {
    try { companies = await api.listCompanies(''); } catch { companies = []; }
    const pick = el('select', {
      class: 'detail-input', 'aria-label': 'Company',
      onchange: () => {
        if (pick.value === '__new__') { askCompanyName(); return; }
        item.company_id = pick.value || null;
        saver.change('company_id', item.company_id);
        drawSub();
      },
    },
    el('option', { value: '' }, 'No company'),
    ...companies.map((c) => el('option', { value: c.id, selected: c.id === item.company_id }, c.name)),
    el('option', { value: '__new__' }, 'New company…'));
    // New company…: its name in a small field under the choice; Enter adds it.
    const newCompany = el('div', { class: 'detail-new' });
    const askCompanyName = () => {
      const input = el('input', {
        class: 'detail-input', 'aria-label': 'New company’s name', placeholder: 'Name of the new company',
        onkeydown: async (event) => {
          if (event.key === 'Escape') { newCompany.replaceChildren(); pick.value = item.company_id ?? ''; return; }
          if (event.key !== 'Enter' || !input.value.trim()) return;
          event.preventDefault();
          const made = await api.createCompany({ name: input.value });
          companies = [...companies, made];
          pick.insertBefore(el('option', { value: made.id }, made.name), pick.lastChild);
          pick.value = made.id;
          newCompany.replaceChildren();
          item.company_id = made.id;
          saver.change('company_id', made.id);
          drawSub();
        },
      });
      newCompany.replaceChildren(input, el('span', { class: 'capture-hint' }, 'Enter adds · Esc cancels'));
      input.focus();
    };
    details.append(
      el('label', { class: 'detail-label' }, 'Company'), el('div', {}, pick, newCompany),
      ...field('Role', item.role, (v) => { item.role = v; saver.change('role', v); drawSub(); }),
      ...field('Emails', item.emails, (v) => saver.change('emails', v), { lines: true, placeholder: 'one per line' }),
      ...field('Phones', item.phones, (v) => saver.change('phones', v), { lines: true, placeholder: 'one per line' }),
      ...field('How we met', item.how_met, (v) => saver.change('how_met', v), { lines: true }),
    );
  } else {
    details.append(...field('Website', item.website, (v) => saver.change('website', v), { placeholder: 'https://…' }));
  }
  drawSub();

  // Your notes about them, with formatting, links and mentions like any note.
  const notesPlace = el('div', { class: 'note-body-place' });
  const editor = createEditor(notesPlace, item.body, {
    onChange: (markdown) => saver.change('body', markdown),
    onFileProblem: (message) => { status.textContent = message; },
    label: 'Notes about them',
    placeholderText: isPerson ? 'What you know about them' : 'What you know about this company',
  });
  const stopDrops = catchPageDrops(editor);
  onLeave(async () => { await saver.close(); stopDrops(); editor.destroy(); });

  // People in depth: how often you want to be in touch, under their name.
  const rhythm = isPerson && moduleOn('people-plus') ? cadenceChip(item) : null;

  // The page as it is: the details, their notes and where they are mentioned. With People in
  // depth on, a Timeline tab sits beside it: the stream for them alone.
  const pagePart = el('div', { class: 'contact-page' },
    details,
    el('h2', { class: 'contact-heading' }, 'Notes'),
    notesPlace,
    ...(isPerson ? [] : [
      el('h2', { class: 'contact-heading' }, 'People here'),
      item.people.length
        ? el('div', { class: 'people-list' }, ...item.people.map((person) => el('a', { class: 'person-row', href: `/people/${person.id}` },
          face('person', person.name), el('span', { class: 'person-row-text' },
            el('span', { class: 'person-row-name' }, person.name), el('span', { class: 'person-row-sub' }, person.role || '')))))
        : el('p', { class: 'empty' }, 'Nobody yet. A person’s page can put them here.'),
    ]),
    linkedFromSection(kind, id, { without: 'event', title: 'Mentioned in', none: `Nothing mentions ${isPerson ? 'them' : 'it'} yet. Type ${isPerson ? '@' : '@@'} and the name in a note or journal entry.` }),
    ...(isPerson && moduleOn('calendar-plus') ? [linkedFromSection(kind, id, { only: 'event', title: `Events with ${item.name.split(' ')[0]}`, none: `No events with ${item.name.split(' ')[0]} yet. Press ⌘K in the Calendar and type, for example, “lunch with ${item.name.split(' ')[0]} thu 12:30 1h”.` })] : []),
  );
  const tabsPart = [];
  if (moduleOn('people-plus')) {
    const view = createTimeline({ about: { kind, id }, kinds: ['note', 'entry', 'task', 'interaction'] });
    const log = logLine({ about: { kind, id }, name: item.name, onLogged: () => { view.load(); if (rhythm) api.getPerson(id).then((fresh) => rhythm.refresh(fresh)).catch(() => {}); } });
    const timelinePart = el('div', { class: 'contact-timeline', role: 'tabpanel', 'aria-label': 'Timeline', hidden: true },
      log.element,
      el('label', { class: 'search contact-timeline-search' }, icon('search'), view.search), view.body);
    const tabButtons = [['page', 'Page'], ['timeline', 'Timeline']].map(([key, label]) => el('button', {
      type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false', onclick: () => choose(key, { remember: true }),
    }, label));
    let loadedTimeline = false;
    const choose = (key, { remember = false } = {}) => {
      tabButtons.forEach((b, i) => b.setAttribute('aria-selected', String(i === (key === 'page' ? 0 : 1))));
      pagePart.hidden = key !== 'page';
      timelinePart.hidden = key !== 'timeline';
      // The address keeps the tab the person chose (other parts of it, like ?task=, are left alone).
      if (remember) {
        const next = new URLSearchParams(location.search);
        if (key === 'timeline') next.set('tab', 'timeline'); else next.delete('tab');
        history.replaceState(null, '', `${location.pathname}${next.size ? `?${next}` : ''}`);
      }
      if (key === 'timeline' && !loadedTimeline) { loadedTimeline = true; view.load(); }
    };
    tabsPart.push(el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Page or Timeline' }, ...tabButtons), timelinePart);
    choose(new URLSearchParams(location.search).get('tab') === 'timeline' ? 'timeline' : 'page');
  }
  screen.append(
    el('div', { class: 'contact-card' }, bigFace, el('div', { class: 'contact-card-text' }, name, sub, ...(rhythm ? [rhythm.element] : []))),
    ...tabsPart.slice(0, 1),
    pagePart,
    ...tabsPart.slice(1),
  );
  showTaskAt(editor);
}
