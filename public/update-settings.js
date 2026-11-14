// Settings › Updates (app-update.js, 2026-11-14, the owner's wish): get the newest version with one press. It shows whether
// a new version is ready (the app looks once a day by itself and never installs by itself), what is new in plain words,
// each step with a tick while it updates, and after it, what came in and a way back to the version before.
// A copy that cannot update itself (installed from a zip, its own branch) gets the one line to paste into Claude Code.

import { el, request, shortDate, clockTime } from './ui.js';

const SHOWN = 8; // what is new: the first few, then "and N more"
const MARKS = { waiting: '○', doing: '…', done: '✓', skipped: '–', failed: '✕' };
const HELP_LINE = 'Still stuck? Post in the Sovran WhatsApp group with a screenshot of this page.';

// The exact line to paste, with a Copy button beside it (the Check button's look).
function pasteLine(line) {
  const copy = el('button', { type: 'button', class: 'button button-quiet', onclick: async () => {
    try { await navigator.clipboard.writeText(line); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select it by hand'; }
  } }, 'Copy');
  return el('div', { class: 'ai-check-line' }, el('code', {}, line), copy);
}

const when = (iso) => `${shortDate(iso)}, ${clockTime(iso)}`;

function newsList(news) {
  const shown = news.slice(0, SHOWN);
  return el('ul', { class: 'update-news', 'aria-label': 'What is new' },
    ...shown.map((line) => el('li', {}, line)),
    ...(news.length > SHOWN ? [el('li', { class: 'update-more' }, `and ${news.length - SHOWN} more`)] : []));
}

function stepList(steps) {
  return el('ol', { class: 'update-steps', 'aria-label': 'Steps' }, ...steps.map((s) => el('li', { 'data-state': s.state },
    el('span', { class: 'update-mark', 'aria-hidden': 'true' }, MARKS[s.state] ?? '○'),
    el('span', {}, s.label))));
}

// After a restart: wait for the app to go, then to come back, then load the page again.
async function waitForRestart(say) {
  const alive = async () => { try { await fetch('/api/health', { signal: AbortSignal.timeout(800) }); return true; } catch { return false; } };
  for (let i = 0; i < 40 && await alive(); i++) await new Promise((resolve) => setTimeout(resolve, 250));
  for (let i = 0; i < 240; i++) {
    if (await alive()) { location.reload(); return; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  say('It did not come back by itself. Open the app from its icon again.');
}

export function updatesSection() {
  const title = el('h2', { class: 'settings-title' }, 'Updates');
  const body = el('div', { class: 'update-body', 'aria-live': 'polite' });
  const section = el('section', { class: 'settings-part', 'aria-label': 'Updates' }, title,
    el('p', { class: 'empty' }, 'Get the newest version of Sovran Advisor. Your notes, journal, people, tasks and settings stay as they are, and a whole copy of them is made first.'),
    body);
  let state = null;
  let confirming = false;

  const button = (label, onclick, kind = '') => el('button', { type: 'button', class: `button ${kind}`.trim(), onclick }, label);
  const say = (text, cls = 'empty') => el('p', { class: cls, role: 'status' }, text);
  const ready = () => Boolean(state?.can && state.check?.behind > 0);

  async function load() {
    try { state = await request('GET', '/api/update'); } catch { body.replaceChildren(say('Whether there is an update couldn’t be loaded.')); return; }
    draw();
    if (state.progress?.running) follow();
  }

  async function look(lookButton) {
    lookButton.disabled = true;
    lookButton.textContent = 'Looking…';
    try { state = await request('POST', '/api/update/check', {}); } catch (err) { state = { ...state, problem: err.message }; }
    draw();
  }

  async function begin(path) {
    confirming = false;
    try { await request('POST', path, {}); } catch (err) { state = { ...state, problem: err.message }; draw(); return; }
    follow();
  }

  // While it runs: the steps with their ticks, every second; at the end, the result (and the restart).
  async function follow() {
    for (;;) {
      try { state = await request('GET', '/api/update'); } catch { break; } // the app is restarting
      draw();
      if (!state.progress?.running) break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (!state.progress || state.progress.result?.restarting) {
      body.append(say('Starting again… this page comes back by itself.'));
      waitForRestart((text) => body.append(say(text)));
    }
  }

  function draw() {
    const s = state;
    title.replaceChildren('Updates', ...(ready() && !s.progress?.running ? [' ', el('span', { class: 'update-ready' }, 'Update ready')] : []));
    const parts = [];
    const progress = s.progress;

    if (!s.can) {
      parts.push(say(s.message ?? 'This copy cannot update itself.'),
        el('p', { class: 'empty' }, 'To update it, open Claude Code (or, with ChatGPT, the Codex app), paste this one line and press Enter:'),
        pasteLine(s.update_line));
      body.replaceChildren(...parts);
      return;
    }

    if (progress?.running || progress?.result) {
      parts.push(stepList(progress.steps));
      const r = progress.result;
      if (r && !r.ok) {
        const box = el('div', { class: 'ai-check-result', 'data-result': r.kind, role: 'alert' }, el('p', { class: 'ai-check-title' }, r.message));
        if (r.kind === 'clash') {
          box.append(el('p', {}, `Where: ${r.files.join(', ')}. Nothing is lost. Claude Code can combine your change with the new version, asking you first. Open Claude Code, paste this line and press Enter:`),
            pasteLine(s.update_line));
        } else if (r.kind === 'offline') {
          box.append(el('p', {}, 'Check the internet connection, then try again.'));
        } else {
          box.append(el('p', {}, 'Nothing you wrote was changed. To update another way, open Claude Code, paste this line and press Enter:'), pasteLine(s.update_line));
          if (r.detail) box.append(el('pre', { class: 'update-detail' }, r.detail));
        }
        box.append(el('p', { class: 'empty' }, HELP_LINE));
        parts.push(box);
      } else if (r?.kind === 'up_to_date') parts.push(say(r.message));
      else if (r?.restarting) parts.push(say(r.message));
    }

    if (!progress?.running && !progress?.result?.restarting) {
      if (s.problem) parts.push(say(s.problem, 'capture-problem'));
      const lookButton = button(s.check ? 'Check again' : 'Check for updates', () => look(lookButton), 'button-quiet');
      if (ready()) {
        parts.push(say(`A new version is ready, with ${s.check.behind === 1 ? 'one change' : `${s.check.behind} changes`}:`), newsList(s.check.news));
        parts.push(el('div', { class: 'library-key' }, button('Update now', () => begin('/api/update'), 'button-primary'), lookButton));
        parts.push(el('p', { class: 'empty' }, 'It takes a minute or two. The app restarts at the end and this page comes back by itself.'));
      } else {
        if (s.check) parts.push(say(`You have the newest version. Last looked ${when(s.check.checked_at)}; it looks again by itself once a day.`));
        else parts.push(say('Press Check for updates to see if there is a new version. The app also looks by itself once a day; it never installs one without you.'));
        parts.push(el('div', { class: 'library-key' }, lookButton));
      }

      // After an update: what came in, and the way back.
      if (s.last) {
        const back = el('div', { class: 'update-last' }, el('h3', { class: 'update-subtitle' }, `Updated ${when(s.last.at)}`));
        if (s.last.news.length) back.append(el('p', { class: 'empty' }, 'What came in:'), newsList(s.last.news));
        if (s.undo?.can && !confirming) back.append(el('div', { class: 'library-key' }, button('Go back to the version before', () => { confirming = true; draw(); }, 'button-quiet')));
        if (s.undo?.can && confirming) {
          back.append(el('div', { class: 'ai-check-result', 'data-result': 'confirm' },
            el('p', { class: 'ai-check-title' }, 'Go back to the version before?'),
            el('p', {}, s.undo.db
              ? `This update also moved your notes forward, so they go back to how they were just before it (${when(s.undo.since)}). Anything you wrote since is not lost: it is kept in a copy in your backups folder, and Claude Code can bring it back.`
              : 'The app goes back to how it was before the update. Your notes stay exactly as they are now.'),
            el('div', { class: 'library-key' }, button('Yes, go back', () => begin('/api/update/undo')), button('Cancel', () => { confirming = false; draw(); }, 'button-quiet'))));
        }
        if (s.undo && !s.undo.can) back.append(el('p', { class: 'empty' }, `The app was changed after this update, so it can’t go back by itself. In Claude Code, paste “${s.undo_line}”.`));
        parts.push(back);
      }
    }
    body.replaceChildren(...parts);
  }

  body.replaceChildren(say('Looking…'));
  load();
  return section;
}
