// The Check button (Settings › Your assistant’s AI, ai.js, 2026-11-12, the owner’s wish): asks the AI one tiny
// question and shows one plain result. Anything but “works” comes with every step to put it right, written for
// someone who has never opened Terminal: how to open it, the exact line to type (with a Copy button), what the
// browser shows, what to press, and to press Check again at the end. The words follow the install guide’s.

import { el, request } from './ui.js';

const PLANS = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' };
const HELP_LINE = 'Still stuck? Post in the Sovran WhatsApp group with a screenshot of this page and a sentence about what you did.';

// A line of words with **bold**, [keys] and `typed text`.
function rich(text) {
  const parts = [];
  const pattern = /\*\*(.+?)\*\*|\[(.+?)\]|`(.+?)`/g;
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    if (m[1]) parts.push(el('b', {}, ...rich(m[1])));
    else if (m[2]) parts.push(el('kbd', {}, m[2]));
    else parts.push(el('code', {}, m[3]));
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

// The exact line to type, with a Copy button beside it.
function typeLine(line) {
  const copy = el('button', { type: 'button', class: 'button button-quiet', onclick: async () => {
    try { await navigator.clipboard.writeText(line); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select it by hand'; }
  } }, 'Copy');
  return el('div', { class: 'ai-check-line' }, el('code', {}, line), copy);
}

const step = (text, ...more) => el('li', {}, el('div', {}, ...rich(text)), ...more);

// The words that differ between a Mac and Windows.
function keysFor(platform) {
  const mac = platform !== 'win32';
  return mac ? {
    mac, shell: 'Terminal', enter: '[return]', paste: '[⌘ command] + [V]', click: 'hold [⌘ command] and click it',
    open: '**Open Terminal.** Press [⌘ command] + [space], type **Terminal**, and press [return]. If Terminal doesn’t appear: click **Finder** in the Dock, press [⌘ command] + [shift] + [U] to open the Utilities folder, and double-click **Terminal**.',
    close: 'Close Terminal: press [⌘ command] + [Q].',
  } : {
    mac, shell: 'PowerShell', enter: '[Enter]', paste: '[Ctrl] + [V] (or right-click)', click: 'hold [Ctrl] and click it',
    open: '**Open PowerShell.** Press the [Windows] key, type **PowerShell**, and press [Enter].',
    close: 'Close PowerShell: type `exit` and press [Enter], or close its window.',
  };
}

// The line that signs in: Claude Code’s own, or Codex’s (the one the app found, quoted when it is a path).
function signInLine(state) {
  if (state.provider === 'codex') return `${state.command === 'codex' ? 'codex' : `"${state.command}"`} login`;
  return 'claude auth login';
}

// Signing in, from opening Terminal to pressing Check again.
function signInSteps(state, k) {
  const claude = state.provider === 'claude';
  return el('ol', { class: 'ai-check-steps' },
    step(k.open),
    step(`**Type this line exactly and press ${k.enter}.** Or press **Copy**, click inside the ${k.shell} window, paste with ${k.paste}, and press ${k.enter}.`, typeLine(signInLine(state))),
    ...(claude ? [step(`If ${k.shell} says it doesn’t know \`auth\` (an older Claude Code), type \`claude\` instead and press ${k.enter}. Press ${k.enter} to accept its setup questions, and when it asks how to sign in, choose **Claude account with subscription**.`)] : []),
    claude
      ? step(`**Your web browser opens a Claude page.** Sign in with the Claude account that has your paid plan (Pro or higher), and press **Authorize**. If the browser doesn’t open by itself, ${k.shell} shows a long web address starting with https: ${k.click}, or copy it into your browser.`)
      : step(`**Your web browser opens a ChatGPT page.** Sign in with your ChatGPT account and allow Codex to use it (press the button to continue). If the browser doesn’t open by itself, ${k.shell} shows a long web address starting with https: ${k.click}, or copy it into your browser.`),
    ...(claude ? [step(`**If the page shows a code instead,** press its Copy button, click inside the ${k.shell} window where it says “Paste code here”, paste with ${k.paste}, and press ${k.enter}.`)] : []),
    step(`**${k.shell} says the sign-in worked** (“Login successful”). ${k.close} It doesn’t need to stay open${claude ? ', and neither does the Claude app' : ''}. You only do this once.`),
    step('**Come back to this page and press Check again** (the button just above these steps). It should now say your assistant works.'));
}

function installSteps(state, k) {
  const claude = state.provider === 'claude';
  if (!claude && !k.mac) {
    return el('p', {}, ...rich('ChatGPT on Windows isn’t ready yet (it hasn’t been tested there). Press **Claude** above to use Claude instead, or wait: everything else in the app works without it.'));
  }
  const install = claude
    ? (k.mac ? 'curl -fsSL https://claude.ai/install.sh | bash' : 'irm https://claude.ai/install.ps1 | iex')
    : 'npm install -g @openai/codex';
  return el('ol', { class: 'ai-check-steps' },
    step(k.open),
    step(`**Type this line exactly and press ${k.enter}.** Or press **Copy**, click inside the ${k.shell} window, paste with ${k.paste}, and press ${k.enter}.${k.mac ? ' If it asks for your Mac password, type it (nothing shows while you type) and press [return].' : ''}`, typeLine(install)),
    step(`**Wait until it says it’s finished** (a minute or two) and you can type again.`),
    step(`**Sign in, in the same window.** Type this line and press ${k.enter}. Your browser opens a ${claude ? 'Claude' : 'ChatGPT'} page: sign in with your ${claude ? 'paid Claude account (Pro or higher) and press **Authorize**' : 'ChatGPT account and allow Codex'}.`, typeLine(claude ? 'claude auth login' : 'codex login')),
    step(`When ${k.shell} says the sign-in worked, close it. ${k.close}`),
    step('**Restart Sovran Advisor** so it finds the new program: press **Restart the app** lower down on this page.'),
    step('**Come back here and press Check again.**'));
}

// What a result says, and what to do: one block.
export function checkAdvice(state) {
  const k = keysFor(state.platform);
  const claude = state.provider === 'claude';
  const name = claude ? 'Claude' : 'ChatGPT';
  const box = (kind, title, ...body) => el('div', { class: 'ai-check-result', 'data-result': kind, role: 'status' },
    el('p', { class: 'ai-check-title' }, title), ...body);
  switch (state.result) {
    case 'working':
      return box('working', `✓ Your assistant works. ${state.program} is installed, signed in${state.plan && PLANS[state.plan] ? ` (${name} ${PLANS[state.plan]} plan)` : ''} and answered.`);
    case 'missing':
      return box('missing', `${state.program} isn’t on this computer, or the app can’t find it.`,
        el('p', {}, `Your assistant runs on ${state.program}, ${name}’s program. Install it once and sign in. It takes about five minutes.`),
        installSteps(state, k), el('p', { class: 'empty' }, HELP_LINE));
    case 'signed_out':
      return box('signed_out', `${state.program} isn’t signed in to your ${name} account.`,
        el('p', {}, `Sign in once, in ${k.shell}. It takes about two minutes.`),
        signInSteps(state, k), el('p', { class: 'empty' }, HELP_LINE));
    case 'free':
      return box('free', 'Your Claude account is on the Free plan.',
        el('p', {}, ...rich('The part of Claude that runs your assistant (Claude Code) needs **Pro or higher**. If you already pay for Claude, you may be signed in with a different account: skip step 1.')),
        el('ol', { class: 'ai-check-steps' },
          step('**Upgrade your Claude account** to Pro or higher, inside the Claude app or on the plans page.',
            el('a', { href: 'https://claude.com/pricing', target: '_blank', rel: 'noopener' }, 'Open Claude’s plans page')),
          step(`**Then sign in again,** so ${state.program} sees your paid plan. Follow these steps:`, signInSteps(state, k))),
        el('p', { class: 'empty' }, HELP_LINE));
    default:
      return box('other', 'Your assistant didn’t answer.',
        ...(state.detail ? [el('p', {}, 'It said: ', el('q', { class: 'ai-check-said' }, state.detail))] : []),
        el('ol', { class: 'ai-check-steps' },
          step('**Check that this computer is online:** open any web page.'),
          step('**If it mentions a limit** (for example “usage limit” or “hit your limit”), your plan’s allowance is used up for now. It says when it starts again: wait until then.'),
          step('**Restart Sovran Advisor:** press **Restart the app** lower down on this page.'),
          step('**Press Check again.**')),
        el('p', { class: 'empty' }, HELP_LINE));
  }
}

// The button and where its result shows. reset() clears the result (another AI was chosen).
export function checkPart() {
  const result = el('div', { class: 'ai-check-out' });
  const button = el('button', { type: 'button', class: 'button button-quiet' }, 'Check');
  const note = el('p', { class: 'empty', role: 'status' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    result.replaceChildren();
    note.textContent = 'Checking… this can take up to a minute: it asks your assistant one tiny question.';
    try {
      const state = await request('POST', '/api/assistant/check', {});
      note.textContent = '';
      result.replaceChildren(checkAdvice(state));
      button.textContent = 'Check again';
    } catch (err) {
      note.textContent = `The check couldn’t run: ${err.message}`;
    }
    button.disabled = false;
  });
  const part = el('div', { class: 'ai-check' },
    el('p', { class: 'empty' }, 'Not sure it works? Press Check: it tests that your assistant is installed, signed in and answering, and tells you exactly what to do if not.'),
    button, note, result);
  part.reset = () => { result.replaceChildren(); note.textContent = ''; button.textContent = 'Check'; };
  return part;
}
