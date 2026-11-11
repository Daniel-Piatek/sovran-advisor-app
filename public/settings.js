// Settings (/settings, assistant/4): what your assistant may do alone, and what waits for
// you. One switch per kind of action (Does it alone · Asks first), read at the moment of
// each step, so it holds in every chat; what asks becomes an approval card in the chat.
// Under the switches, the floor no switch moves, and the activity log: every switch you
// changed and every step it took, asked for or was refused.

import { el, icon, request, clockTime, shortDate, undoBar } from './ui.js';
import { app, screen, loadCourse } from './shell.js';
import { listedModules, switchModule, moduleOn } from './modules.js';
import { googleSection, googleCalendarSection } from './google.js';
import { readTimings, BUDGET_MS } from './timings.js';
import { importSection } from './import-notes.js';
import { captureSection } from './capture-settings.js';

const permissionsApi = {
  get: () => request('GET', '/api/assistant/permissions'),
  remove: (rule) => request('DELETE', '/api/assistant/permissions', { rule }),
  set: (key, mode) => request('PUT', '/api/assistant/permissions', { key, mode }),
};

const KIND_WORDS = { switch: 'You switched', did: 'Did', asked: 'Asked', approved: 'You allowed', 'not now': 'You said no', undone: 'Undone', refused: 'Refused' };

// The glossary (advanced/voice/2): your names and terms, given to the speech to text with every dictation.
// Fixes first (heard as → written as), then what you added, then the hints from People and companies.
const SOURCE_WORDS = { person: 'From People', company: 'From Companies', typed: 'You added it', learned: 'Learned from a correction' };
export function glossaryRow(g, { onDelete = null } = {}) {
  return el('div', { class: 'glossary-row', 'data-kind': g.kind },
    el('span', { class: 'tag' }, g.kind === 'fix' ? 'Fix' : 'Hint'),
    el('span', { class: 'glossary-term' }, g.kind === 'fix' ? el('span', { class: 'glossary-heard' }, `“${g.heard_as}” → `) : null, el('strong', {}, g.term)),
    el('span', { class: 'glossary-source' }, SOURCE_WORDS[g.source] ?? ''),
    ...(onDelete ? [el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Remove ${g.term}`, onclick: () => onDelete(g) }, icon('trash'))] : []));
}

function glossarySection() {
  const heard = el('input', { class: 'detail-input', 'aria-label': 'Heard as', placeholder: 'Heard as (leave empty for a hint)', autocomplete: 'off', maxlength: 80 });
  const written = el('input', {
    class: 'detail-input', 'aria-label': 'Written as', placeholder: 'Written as, e.g. Nordlicht', autocomplete: 'off', maxlength: 80,
    onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } },
  });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Search the glossary', 'aria-label': 'Search the glossary', autocomplete: 'off', oninput: () => { clearTimeout(timer); timer = setTimeout(load, 150); } });
  const list = el('div', { class: 'glossary-list', 'aria-live': 'polite' });
  const undoPlace = el('div', {});
  let timer = null;
  let run = 0;

  async function add() {
    try {
      await request('POST', '/api/glossary', { term: written.value, heard_as: heard.value });
      heard.value = '';
      written.value = '';
      problem.textContent = '';
      load();
    } catch (err) { problem.textContent = err.message; }
  }

  async function load() {
    const mine = ++run;
    let rows = [];
    try { rows = await request('GET', `/api/glossary?${new URLSearchParams({ q: search.value.trim() })}`); } catch {
      list.replaceChildren(el('p', { class: 'empty' }, "The glossary couldn't be loaded. Is the app still running?"));
      return;
    }
    if (mine !== run) return;
    list.replaceChildren(...(rows.length ? rows.map((g) => glossaryRow(g, {
      onDelete: async () => {
        await request('DELETE', `/api/glossary/${g.id}`);
        undoPlace.replaceChildren(undoBar(`“${g.term}” removed from the glossary.`, async () => { await request('POST', `/api/glossary/${g.id}/restore`, {}); load(); }));
        load();
      },
    })) : [el('p', { class: 'empty' }, search.value.trim() ? 'Nothing in the glossary matches.' : 'Nothing yet. People and companies you add become hints.')]));
  }

  load();
  return el('section', { class: 'settings-part', 'aria-label': 'Glossary' },
    el('h2', { class: 'settings-title' }, 'Glossary'),
    el('p', { class: 'empty' }, 'Your names and terms, given to the speech to text with every dictation. A hint makes it expect a word; a fix rewrites what it keeps getting wrong (“North light” → Nordlicht). Correct a word you just dictated and the app offers to learn it.'),
    el('div', { class: 'glossary-add' }, heard, el('span', { 'aria-hidden': 'true' }, '→'), written, el('button', { type: 'button', class: 'button', onclick: add }, icon('plus'), 'Add')),
    problem, search, list, undoPlace);
}

// Dictation (advanced/voice/1): the hold key, whether there is a key for speech to text, and every
// dictation kept as text, newest first, searchable, each with Copy.
function dictationSection() {
  const status = el('p', { class: 'empty', role: 'status' });
  const keys = el('div', { class: 'switch', role: 'group', 'aria-label': 'Hold key' });
  const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Search your dictations', 'aria-label': 'Search your dictations', autocomplete: 'off', oninput: () => { clearTimeout(timer); timer = setTimeout(load, 150); } });
  const list = el('div', { class: 'dictation-list', 'aria-live': 'polite' });
  let timer = null;
  let run = 0;

  const keyInput = el('input', {
    // Not a password field: a password manager (LastPass...) would offer to save this as a login. The dots are drawn by the style.
    type: 'text', class: 'detail-input secret-input', 'aria-label': 'ElevenLabs key', placeholder: 'Paste your ElevenLabs key', autocomplete: 'off', spellcheck: 'false',
    autocapitalize: 'off', 'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other',
    onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); saveKeyNow(); } },
  });
  const keyProblem = el('p', { class: 'capture-problem', role: 'alert' });
  const removeButton = el('button', { type: 'button', class: 'button button-quiet', onclick: async () => { drawSettings(await request('DELETE', '/api/dictation/key')); } }, 'Remove key');
  async function saveKeyNow() {
    try {
      const next = await request('PUT', '/api/dictation/key', { key: keyInput.value });
      keyInput.value = '';
      keyProblem.textContent = '';
      drawSettings(next);
    } catch (err) { keyProblem.textContent = err.message; }
  }

  function drawSettings(s) {
    status.textContent = s.has_key
      ? `Speech to text is connected (the key is ${s.key_source === 'env' ? 'in this app’s environment' : 'kept in data/elevenlabs.key, on this computer only'}; it is never shown). Your voice goes to ElevenLabs only while you dictate.`
      : 'No ElevenLabs key yet. Paste it below once; it is kept in data/elevenlabs.key on this computer and never shown again.';
    removeButton.hidden = s.key_source !== 'file';
    keys.replaceChildren(...s.hold_keys.map((k) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(k.code === s.hold_key),
      onclick: async () => {
        const next = await request('PUT', '/api/dictation/settings', { hold_key: k.code });
        document.dispatchEvent(new CustomEvent('dictation-settings', { detail: next }));
        drawSettings(next);
      },
    }, k.label)));
  }

  async function load() {
    const mine = ++run;
    let rows = [];
    try { rows = await request('GET', `/api/dictations?${new URLSearchParams({ q: search.value.trim(), limit: '100' })}`); } catch {
      list.replaceChildren(el('p', { class: 'empty' }, "The history couldn't be loaded. Is the app still running?"));
      return;
    }
    if (mine !== run) return;
    list.replaceChildren(...(rows.length ? rows.map((d) => el('div', { class: 'dictation-row', 'data-outcome': d.outcome },
      el('span', { class: 'dictation-when' }, `${shortDate(d.created_at)} ${clockTime(d.created_at)}`),
      el('span', { class: 'dictation-text' }, d.text,
        el('span', { class: 'dictation-went' }, d.outcome === 'clipboard' ? ' · Clipboard only' : d.went_to ? ` · ${d.went_to}` : '')),
      el('button', {
        type: 'button', class: 'button button-quiet', 'aria-label': `Copy: ${d.text.slice(0, 40)}`,
        onclick: async (event) => {
          const button = event.currentTarget; // gone after the first await
          try { await navigator.clipboard.writeText(d.text); button.textContent = 'Copied'; } catch { button.textContent = 'Not copied'; }
        },
      }, 'Copy')))
      : [el('p', { class: 'empty' }, search.value.trim() ? 'No dictation has those words.' : 'Nothing dictated yet. Hold the key in a field and speak.')]));
  }

  request('GET', '/api/dictation/settings').then(drawSettings).catch(() => { status.textContent = "Dictation's settings couldn't be loaded."; });
  load();
  return el('section', { class: 'settings-part', 'aria-label': 'Dictation' },
    el('h2', { class: 'settings-title' }, 'Dictation'),
    el('p', { class: 'empty' }, 'Hold the key in any field, speak, let go: your words land at the cursor. The mic in the pill at the foot of the page listens hands-free.'),
    status,
    el('div', { class: 'permission-row' }, el('span', { class: 'permission-name' }, 'ElevenLabs key'),
      el('div', { class: 'dictation-key' }, keyInput, el('button', { type: 'button', class: 'button', onclick: saveKeyNow }, 'Save key'), removeButton)),
    keyProblem,
    el('div', { class: 'permission-row' }, el('span', { class: 'permission-name' }, 'Hold key'), keys),
    el('h3', { class: 'settings-title' }, 'Your dictations'), search, list);
}

// Calendar timings (Calendar in depth 10): the last actions of the Calendar and the Planner with how long each took to be on screen.
// Every one is meant to stay under 100 ms; one that does not says so in words.
function timingsSection() {
  const list = readTimings();
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const names = [...new Set(list.map((t) => t.name))];
  return el('section', { class: 'settings-part', 'aria-label': 'Calendar timings' },
    el('h2', { class: 'settings-title' }, 'Calendar timings'),
    el('p', { class: 'empty' }, `Every action of the Calendar and the Planner is measured from the moment you ask to the next frame after its result is drawn. The goal is under ${BUDGET_MS} ms; the last fifty are kept in this browser.`),
    list.length ? el('div', { class: 'timings' },
      ...names.map((name) => {
        const mine = list.filter((t) => t.name === name).map((t) => t.ms);
        return el('div', { class: 'permission-row', 'data-timing': name },
          el('span', { class: 'permission-name' }, name, el('span', { class: 'permission-what' }, `${mine.length} ${mine.length === 1 ? 'time' : 'times'} · usually ${median(mine)} ms · slowest ${Math.max(...mine)} ms${Math.max(...mine) >= BUDGET_MS ? ` · over ${BUDGET_MS} ms at least once` : ''}`)));
      }),
      el('h3', { class: 'shutdown-title' }, 'The last actions'),
      ...[...list].reverse().slice(0, 12).map((t) => el('p', { class: 'permission-what timing-row' }, `${shortDate(t.at)} ${clockTime(t.at)} · ${t.name} · ${t.ms} ms${t.ms >= BUDGET_MS ? ` · over ${BUDGET_MS} ms` : ''}`)))
      : el('p', { class: 'empty' }, 'Nothing measured yet in this browser: move an event or switch the Planner’s lens, then come back.'));
}

// Which AI answers (ai.js): your own Claude, or your own ChatGPT. Each runs on this computer, signed in
// with your own account; the page says whether its program is installed.
const AI = {
  claude: { name: 'Claude', program: 'Claude Code', missing: 'Claude Code isn’t set up on this computer yet. Install it and sign in once (the install guide says how), then open this page again.' },
  codex: { name: 'ChatGPT', program: 'Codex', missing: 'Codex, ChatGPT’s program, isn’t set up on this computer yet. Install it and sign in once with your ChatGPT account (the install guide says how), then open this page again.' },
};
function aiSection() {
  const status = el('p', { class: 'empty', role: 'status' });
  const buttons = Object.entries(AI).map(([provider, ai]) => el('button', {
    type: 'button', class: 'button button-quiet', 'data-provider': provider, 'aria-pressed': 'false',
    onclick: () => save(provider),
  }, ai.name));
  const show = (state) => {
    for (const b of buttons) {
      const on = b.dataset.provider === state.provider;
      b.setAttribute('aria-pressed', String(on));
      b.className = on ? 'button' : 'button button-quiet';
    }
    const ai = AI[state.provider];
    status.textContent = state.ready[state.provider]
      ? `Your assistant runs on your own ${ai.name} (${ai.program}), on this computer.`
      : ai.missing;
  };
  const save = async (provider) => {
    try { show(await request('PUT', '/api/assistant/ai', { provider })); } catch (err) { status.textContent = err.message; }
  };
  request('GET', '/api/assistant/ai').then(show).catch(() => { status.textContent = 'Which AI you use couldn’t be loaded.'; });
  return el('section', { class: 'settings-part', 'aria-label': 'Which AI' },
    el('h2', { class: 'settings-title' }, 'Your assistant’s AI'),
    el('p', { class: 'empty' }, 'Choose the one you have a plan with. It answers in the Assistant and sorts your Inbox in the background. Your notes stay on this computer either way.'),
    el('div', { class: 'library-key', role: 'group', 'aria-label': 'AI' }, ...buttons),
    status);
}

// The Sovran Library (sovran-library.js): the key the student was given, pasted once. Only its last four
// characters ever come back to the page.
function librarySection() {
  const status = el('p', { class: 'empty', role: 'status' });
  const input = el('input', { type: 'password', class: 'detail-input', 'aria-label': 'Library key', placeholder: 'Paste your library key', autocomplete: 'off' });
  const remove = el('button', { type: 'button', class: 'button button-quiet', hidden: true }, 'Disconnect');
  const show = (state) => {
    status.textContent = state.connected
      ? `Connected (key ending ${state.key_end}). Your assistant can now search the Sovran teaching and your own decodes.`
      : 'Not connected. The app works fully without it.';
    remove.hidden = !state.connected;
  };
  const save = async (key) => {
    try { show(await request('PUT', '/api/library', { key })); input.value = ''; } catch (err) { status.textContent = err.message; }
  };
  remove.addEventListener('click', () => save(''));
  request('GET', '/api/library').then(show).catch(() => { status.textContent = "The library's state couldn't be loaded."; });
  return el('section', { class: 'settings-part', 'aria-label': 'Sovran Library' },
    el('h2', { class: 'settings-title' }, 'Sovran Library'),
    el('p', { class: 'empty' }, 'Paste the key you were given. Your assistant then reads the Sovran teaching and, if you have them, your own decodes. The key stays on this computer.'),
    el('form', { class: 'library-key', onsubmit: (event) => { event.preventDefault(); if (input.value.trim()) save(input.value); } },
      input, el('button', { type: 'submit', class: 'button' }, 'Connect'), remove),
    status);
}

// The course page (course.js): the address the Course link opens. The app may come with one; another can be
// set here, and clearing it goes back to the app's own (if it has none, the link goes).
function courseSection() {
  const status = el('p', { class: 'empty', role: 'status' });
  const input = el('input', { type: 'text', class: 'detail-input', 'aria-label': 'Course page address', placeholder: 'https://…', autocomplete: 'off' });
  const reset = el('button', { type: 'button', class: 'button button-quiet', hidden: true }, 'Use the app’s own');
  const show = (state) => {
    input.value = state.url;
    status.textContent = state.url ? 'The Course link in the sidebar opens this page.' : 'No course page yet: the Course link shows once there is one.';
    reset.hidden = !state.own;
    loadCourse();
  };
  const save = async (url) => {
    try { show(await request('PUT', '/api/course', { url })); } catch (err) { status.textContent = err.message; }
  };
  reset.addEventListener('click', () => save(''));
  request('GET', '/api/course').then(show).catch(() => { status.textContent = "The course page's address couldn't be loaded."; });
  return el('section', { class: 'settings-part', 'aria-label': 'Course' },
    el('h2', { class: 'settings-title' }, 'Course'),
    el('p', { class: 'empty' }, 'The page online for your course: the session replays, the homework and your questions.'),
    el('form', { class: 'library-key', onsubmit: (event) => { event.preventDefault(); save(input.value); } },
      input, el('button', { type: 'submit', class: 'button' }, 'Save'), reset),
    status);
}

export async function showSettings() {
  document.title = 'Settings';
  app.className = 'page';
  const rows = el('div', { class: 'permission-rows' });
  const log = el('ol', { class: 'activity-log', 'aria-label': 'Activity' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const allowedList = el('ul', { class: 'allowed-list' });
  const moduleRows = el('div', { class: 'permission-rows' });
  // The Dictation part is there while the module is on (it follows the switch above).
  const dictationPlace = el('div', {});
  const drawDictation = () => {
    const there = dictationPlace.childElementCount > 0;
    if (moduleOn('voice') && !there) dictationPlace.replaceChildren(dictationSection(), glossarySection());
    else if (!moduleOn('voice') && there) dictationPlace.replaceChildren();
  };
  // The Google part is there while Google Calendar is on, with the Google Calendar part.
  const googlePlace = el('div', {});
  const drawGoogle = () => {
    const state = `${moduleOn('calendar-google')}`;
    if (googlePlace.dataset.state === state) return;
    googlePlace.dataset.state = state;
    googlePlace.replaceChildren(...(moduleOn('calendar-google') ? [googleSection(), googleCalendarSection()] : []));
  };
  // Import is a part of Writing and thinking: there while it is on.
  const importPlace = el('div', {});
  const drawImport = () => {
    const there = importPlace.childElementCount > 0;
    if (moduleOn('writing') && !there) importPlace.replaceChildren(importSection());
    else if (!moduleOn('writing') && there) importPlace.replaceChildren();
  };
  // Capture from anywhere is a part of Tasks in depth: there while it is on.
  const capturePlace = el('div', {});
  const drawCapture = () => {
    const there = capturePlace.childElementCount > 0;
    if (moduleOn('tasks-plus') && !there) capturePlace.replaceChildren(captureSection());
    else if (!moduleOn('tasks-plus') && there) capturePlace.replaceChildren();
  };
  const moduleProblem = el('p', { class: 'capture-problem', role: 'alert' });

  // One row a module: its name and what it does, and an On · Off switch.
  function drawModules() {
    moduleRows.replaceChildren(...listedModules().map((m) => el('div', { class: 'permission-row', 'data-module': m.id },
      el('span', { class: 'permission-name' }, m.label, el('span', { class: 'permission-what' }, m.description)),
      el('div', { class: 'switch', role: 'group', 'aria-label': m.label },
        ...[[true, 'On'], [false, 'Off']].map(([on, label]) => el('button', {
          type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(m.on === on),
          onclick: async () => {
            try { await switchModule(m.id, on); moduleProblem.textContent = ''; drawModules(); drawJobs(); drawDictation(); drawGoogle(); drawCapture(); drawImport(); } catch (err) { moduleProblem.textContent = err.message; }
          },
        }, label))))));
  }
  // Background jobs: what runs by itself, how often, when it last did. A job leaves with its module.
  const jobRows = el('div', {});
  async function drawJobs() {
    let jobs = [];
    try { jobs = await request('GET', '/api/jobs'); } catch { /* the list waits for the next visit */ }
    jobRows.replaceChildren(...jobs.map((job) => el('div', { class: 'permission-row', 'data-job': job.id },
      el('span', { class: 'permission-name' }, job.label,
        el('span', { class: 'permission-what' }, !job.on ? 'Off' : `Every ${job.every_seconds ? `${job.every_seconds} seconds` : `${job.every_minutes} minutes`} · ${job.last_run ? `last ran ${shortDate(job.last_run)} ${clockTime(job.last_run)}` : 'has not run yet'}`)))));
  }
  drawModules();
  drawJobs();
  drawDictation();
  drawGoogle();
  drawCapture();
  drawImport();
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Settings')),
    aiSection(),
    librarySection(),
    ...(moduleOn('course') ? [courseSection()] : []),
    el('section', { class: 'settings-part', 'aria-label': 'Your assistant' },
      el('h2', { class: 'settings-title' }, 'What your assistant may do alone'),
      el('p', { class: 'empty' }, 'Does it alone: it happens when you ask for it. Asks first: it waits for your yes on a card in the chat.'),
      rows, problem,
      el('div', { class: 'permission-floor', role: 'note', 'aria-label': 'Always' },
        el('p', { class: 'permission-floor-line' }, icon('lock'), el('span', {}, el('b', {}, 'Always asks: '), 'deleting anything.')),
        el('p', { class: 'permission-floor-line' }, icon('lock'), el('span', {}, el('b', {}, 'Never, whatever is switched on: '),
          'sudo, wiping a disk, your passwords and the keychain, scripting other apps.')))),
    el('section', { class: 'settings-part', 'aria-label': 'Modules' },
      el('h2', { class: 'settings-title' }, 'Modules'),
      el('p', { class: 'empty' }, 'Parts of the app you can switch off. A module that is off hides its menus and chips and keeps everything it made.'),
      moduleRows, moduleProblem),
    el('section', { class: 'settings-part', 'aria-label': 'Background jobs' },
      el('h2', { class: 'settings-title' }, 'Background jobs'),
      el('p', { class: 'empty' }, 'What the app does by itself, how often, and when it last did. A job stops when its module is off.'),
      jobRows),
    ...(moduleOn('calendar-plus') ? [timingsSection()] : []),
    capturePlace,
    importPlace,
    googlePlace,
    dictationPlace,
    el('section', { class: 'settings-part', 'aria-label': 'Always allowed' },
      el('h2', { class: 'settings-title' }, 'Always allowed'),
      el('p', { class: 'empty' }, 'Kinds of step you chose “Always allow” for on a card. They no longer ask. Deleting and the floor always do.'),
      allowedList),
    el('section', { class: 'settings-part', 'aria-label': 'Activity' },
      el('h2', { class: 'settings-title' }, 'Activity'), log),
  );

  function draw({ permissions, allowed = [], activity }) {
    allowedList.replaceChildren(...(allowed.length ? allowed.map((a) => el('li', { class: 'allowed-row' },
      el('span', {}, a.label),
      el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Remove: ${a.label}`, onclick: async () => {
        try { draw(await permissionsApi.remove(a.rule)); } catch (err) { problem.textContent = err.message; }
      } }, icon('close'), 'Remove')))
      : [el('li', { class: 'empty' }, 'Nothing yet.')]));
    rows.replaceChildren(...permissions.map((p) => el('div', { class: 'permission-row' },
      el('span', { class: 'permission-name' }, p.name),
      el('div', { class: 'switch', role: 'group', 'aria-label': p.name },
        ...[['alone', 'Does it alone'], ['ask', 'Asks first']].map(([mode, label]) => el('button', {
          type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(p.mode === mode),
          onclick: async () => {
            try { draw(await permissionsApi.set(p.key, mode)); } catch (err) { problem.textContent = err.message; }
          },
        }, label))))));
    log.replaceChildren(...(activity.length ? activity.map((a) => el('li', { class: 'activity-row', 'data-kind': a.kind },
      el('span', { class: 'activity-when' }, `${shortDate(a.created_at)} ${clockTime(a.created_at)}`),
      el('span', { class: 'activity-what' }, el('b', {}, `${KIND_WORDS[a.kind] ?? a.kind} `), a.what),
      ...(a.conversation_id ? [el('a', { class: 'activity-chat', href: `/assistant/${a.conversation_id}` }, 'chat')] : [])))
      : [el('li', { class: 'empty' }, 'Nothing yet.')]));
  }

  try { draw(await permissionsApi.get()); } catch { problem.textContent = "Settings couldn't be loaded. Is the app still running?"; }
}
