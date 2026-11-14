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
import { voiceSection, voiceLogSection } from './voice-settings.js';
import { everywhereSection } from './everywhere-settings.js';
import { phoneDropSection } from './phone-drop-settings.js';
import { checkPart } from './ai-check.js';
import { fold } from './fold.js';
import { updatesSection } from './update-settings.js';

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
  const folded = fold('glossary', 'Your glossary', search, list);
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
    if (!search.value.trim()) folded.say(rows.length, ['word', 'words'], `${rows.filter((g) => g.kind === 'fix').length} fixes`);
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
    problem, undoPlace, folded);
}

// Your assistant and mail (advanced/mail/11): the limits it is held to, read only. They are in code, not in a prompt, so there is nothing to switch.
function mailLimitsSection() {
  const list = el('ul', { class: 'allowed-list', 'aria-label': 'Limits' });
  request('GET', '/api/mail/limits').then((data) => {
    list.replaceChildren(...data.rules.map((r) => el('li', { class: 'allowed-row', 'data-rule': r.key }, icon('lock'), el('span', {}, r.text))),
      el('li', { class: 'empty' }, `Drafted today: ${data.drafted_today} of ${data.limits.drafts_per_day}.`));
  }).catch(() => list.replaceChildren(el('li', { class: 'empty' }, "The limits couldn't be loaded.")));
  return el('section', { class: 'settings-part', 'aria-label': 'Your assistant and mail' },
    el('h2', { class: 'settings-title' }, 'Your assistant and mail'),
    el('p', { class: 'empty' }, 'While Mail is on, your assistant can search and read your mail, make a task of a conversation and draft a reply. These limits are checked in code on every draft, whatever it is told, and cannot be changed here.'),
    list);
}


// Dictation (advanced/voice/1): the hold key, whether there is a key for speech to text, and every
// dictation kept as text, newest first, searchable, each with Copy.
function dictationSection() {
  const status = el('p', { class: 'empty', role: 'status' });
  const keys = el('div', { class: 'switch', role: 'group', 'aria-label': 'Hold key' });
  const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Search your dictations', 'aria-label': 'Search your dictations', autocomplete: 'off', oninput: () => { clearTimeout(timer); timer = setTimeout(load, 150); } });
  const list = el('div', { class: 'dictation-list', 'aria-live': 'polite' });
  const folded = fold('dictations', 'Your dictations', search, list);
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

  // The free voice model on this computer: used whenever there is no ElevenLabs key.
  const localLine = el('p', { class: 'empty', role: 'status', 'aria-label': 'Free voice model' });
  const getButton = el('button', { type: 'button', class: 'button', onclick: async () => { drawLocal(await request('POST', '/api/dictation/local/prepare', {})); } }, 'Get it now');
  let poll = null;
  function drawLocal(local, hasKey) {
    clearTimeout(poll);
    const lines = {
      ready: 'Free voice model: ready. Your voice is turned into words on this computer and never leaves it.',
      getting: `Free voice model: getting it, once (about 200 MB): ${local.percent ?? 0}%. Dictation works when it is done.`,
      missing: 'Free voice model: not on this computer yet (about 200 MB, fetched once).',
      failed: `Free voice model: ${local.message ?? 'it could not be fetched.'}`,
      unavailable: local.message ?? 'The free voice model can’t run on this computer.',
    };
    localLine.textContent = (lines[local.state] ?? '') + (hasKey ? ' It is not used while there is an ElevenLabs key.' : '');
    getButton.hidden = !['missing', 'failed'].includes(local.state);
    getButton.textContent = local.state === 'failed' ? 'Try again' : 'Get it now';
    if (local.state === 'getting') {
      poll = setTimeout(async () => {
        if (!localLine.isConnected) return;
        try { const next = await request('GET', '/api/dictation/settings'); drawLocal(next.local, next.has_key); } catch { /* the next look will say */ }
      }, 1500);
    }
  }

  function drawSettings(s) {
    if (s.local) drawLocal(s.local, s.has_key);
    status.textContent = s.has_key
      ? `ElevenLabs is connected and used instead of the free model: your words show as you speak (the key is ${s.key_source === 'env' ? 'in this app’s environment' : 'kept in data/elevenlabs.key, on this computer only'}; it is never shown). Your voice goes to ElevenLabs only while you dictate.`
      : 'Optional: an ElevenLabs key (a paid service) shows your words as you speak. Paste it below once; it is kept in data/elevenlabs.key on this computer and never shown again.';
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
    if (!search.value.trim()) folded.say(rows.length, ['dictation', 'dictations'], rows[0] ? `latest ${shortDate(rows[0].created_at)} ${clockTime(rows[0].created_at)}` : '');
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
    el('div', { class: 'dictation-local' }, localLine, getButton),
    status,
    el('div', { class: 'permission-row' }, el('span', { class: 'permission-name' }, 'ElevenLabs key'),
      el('div', { class: 'dictation-key' }, keyInput, el('button', { type: 'button', class: 'button', onclick: saveKeyNow }, 'Save key'), removeButton)),
    keyProblem,
    el('div', { class: 'permission-row' }, el('span', { class: 'permission-name' }, 'Hold key'), keys),
    folded);
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
      lastActions(list))
      : el('p', { class: 'empty' }, 'Nothing measured yet in this browser: move an event or switch the Planner’s lens, then come back.'));
}

function lastActions(list) {
  const last = [...list].reverse().slice(0, 12);
  const folded = fold('timings', 'The last actions',
    ...last.map((t) => el('p', { class: 'permission-what timing-row' }, `${shortDate(t.at)} ${clockTime(t.at)} · ${t.name} · ${t.ms} ms${t.ms >= BUDGET_MS ? ` · over ${BUDGET_MS} ms` : ''}`)));
  folded.say(last.length, ['action', 'actions'], `${last.filter((t) => t.ms >= BUDGET_MS).length} over ${BUDGET_MS} ms`);
  return folded;
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
  const check = checkPart();
  const save = async (provider) => {
    try { show(await request('PUT', '/api/assistant/ai', { provider })); check.reset(); } catch (err) { status.textContent = err.message; }
  };
  request('GET', '/api/assistant/ai').then(show).catch(() => { status.textContent = 'Which AI you use couldn’t be loaded.'; });
  return el('section', { class: 'settings-part', 'aria-label': 'Which AI' },
    el('h2', { class: 'settings-title' }, 'Your assistant’s AI'),
    el('p', { class: 'empty' }, 'Choose the one you have a plan with. It answers in the Assistant and sorts your Inbox in the background. Your notes stay on this computer either way.'),
    el('div', { class: 'library-key', role: 'group', 'aria-label': 'AI' }, ...buttons),
    status, check);
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

// A button that was pressed says so on itself (a turning ring and what it is doing), and its message shows right under it.
function working(button, label) {
  const before = button.textContent;
  button.classList.add('is-working');
  button.textContent = label;
  return () => { button.classList.remove('is-working'); button.textContent = before; };
}

// Restart: after an update, or when something asks for it, without the Terminal. The app stops, starts again
// by itself (a changed database is moved forward with a whole copy kept first), and this page comes back.
function restartSection() {
  const status = el('p', { class: 'action-status', role: 'status', 'aria-live': 'polite' });
  const button = el('button', { type: 'button', class: 'button' }, 'Restart the app');
  button.addEventListener('click', async () => {
    button.disabled = true;
    const done = working(button, 'Restarting…');
    status.dataset.kind = 'working';
    status.textContent = 'Restarting now: this page comes back by itself in a moment.';
    try { await request('POST', '/api/restart', {}); } catch { done(); status.dataset.kind = 'problem'; status.textContent = 'This copy of the app cannot restart itself. Close it and open it again.'; button.disabled = false; return; }
    const alive = async () => { try { await fetch('/api/health', { signal: AbortSignal.timeout(800) }); return true; } catch { return false; } };
    for (let i = 0; i < 40 && await alive(); i++) await new Promise((resolve) => setTimeout(resolve, 250)); // wait for it to go
    for (let i = 0; i < 120; i++) {
      if (await alive()) { location.reload(); return; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    done();
    status.dataset.kind = 'problem';
    status.textContent = 'It did not come back. Open the app from its icon, or ask Claude for help.';
    button.disabled = false;
  });
  return el('section', { class: 'settings-part', 'aria-label': 'Restart' },
    el('h2', { class: 'settings-title' }, 'Restart'),
    el('p', { class: 'empty' }, 'After an update the app may ask for a restart. This stops it and starts it again; your data stays as it is.'),
    el('div', { class: 'library-key' }, button), status);
}

export async function showSettings() {
  document.title = 'Settings';
  app.className = 'page';
  const rows = el('div', { class: 'permission-rows' });
  const log = el('ol', { class: 'activity-log', 'aria-label': 'Activity' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const allowedList = el('ul', { class: 'allowed-list' });
  const allowedFold = fold('always-allowed', 'Kinds of step', allowedList);
  const logFold = fold('activity', 'Every step', log);
  const moduleRows = el('div', { class: 'permission-rows' });
  // The Dictation part is there while the module is on (it follows the switch above).
  const dictationPlace = el('div', {});
  const drawDictation = () => {
    const there = dictationPlace.childElementCount > 0;
    if (moduleOn('voice') && !there) dictationPlace.replaceChildren(dictationSection(), glossarySection(), voiceSection(), voiceLogSection());
    else if (!moduleOn('voice') && there) dictationPlace.replaceChildren();
  };
  // The Google part is there while Mail or Google Calendar is on (the sign-in is the shared piece); the Mail limits with Mail, the
  // Google Calendar part with Google Calendar.
  const googlePlace = el('div', {});
  const drawGoogle = () => {
    const state = `${moduleOn('mail')}${moduleOn('calendar-google')}`;
    if (googlePlace.dataset.state === state) return;
    googlePlace.dataset.state = state;
    googlePlace.replaceChildren(...(moduleOn('mail') || moduleOn('calendar-google') ? [googleSection()] : []),
      ...(moduleOn('calendar-google') ? [googleCalendarSection()] : []), ...(moduleOn('mail') ? [mailLimitsSection()] : []));
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
  // Phone, backups and moving: there while its module is on.
  const everywherePlace = el('div', {});
  const drawEverywhere = () => {
    const there = everywherePlace.childElementCount > 0;
    if (moduleOn('everywhere') && !there) everywherePlace.replaceChildren(everywhereSection());
    else if (!moduleOn('everywhere') && there) everywherePlace.replaceChildren();
  };
  // Phone capture: there while its module is on.
  const phoneDropPlace = el('div', {});
  const drawPhoneDrop = () => {
    const there = phoneDropPlace.childElementCount > 0;
    if (moduleOn('phone-drop') && !there) phoneDropPlace.replaceChildren(phoneDropSection());
    else if (!moduleOn('phone-drop') && there) phoneDropPlace.replaceChildren();
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
            try { await switchModule(m.id, on); moduleProblem.textContent = ''; drawModules(); drawJobs(); drawDictation(); drawGoogle(); drawCapture(); drawImport(); drawEverywhere(); drawPhoneDrop(); } catch (err) { moduleProblem.textContent = err.message; }
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
  drawEverywhere();
  drawPhoneDrop();
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Settings')),
    aiSection(),
    updatesSection(),
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
    phoneDropPlace,
    everywherePlace,
    importPlace,
    googlePlace,
    dictationPlace,
    restartSection(),
    el('section', { class: 'settings-part', 'aria-label': 'Always allowed' },
      el('h2', { class: 'settings-title' }, 'Always allowed'),
      el('p', { class: 'empty' }, 'Kinds of step you chose “Always allow” for on a card. They no longer ask. Deleting and the floor always do.'),
      allowedFold),
    el('section', { class: 'settings-part', 'aria-label': 'Activity' },
      el('h2', { class: 'settings-title' }, 'Activity'),
      el('p', { class: 'empty' }, 'Every switch you changed and every step your assistant took, asked for or was refused, newest first.'),
      logFold),
  );

  function draw({ permissions, allowed = [], activity }) {
    allowedFold.say(allowed.length, ['kind of step', 'kinds of step']);
    logFold.say(activity.length, ['step', 'steps'], activity[0] ? `latest ${shortDate(activity[0].created_at)} ${clockTime(activity[0].created_at)}` : '');
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
