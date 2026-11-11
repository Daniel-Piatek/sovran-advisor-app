// The welcome (/welcome, Sovran Advisor): the first screen of a new install. What the app is
// for in D's words, the student's name, whether their assistant is ready, and one first
// step (the journal). Any link on it marks the welcome as seen; it stays at /welcome to read again.

import { el, icon, request } from './ui.js';
import { app, screen } from './shell.js';

export const welcomeState = () => request('GET', '/api/welcome');

export async function showWelcome() {
  document.title = 'Welcome';
  app.className = 'page welcome-page';
  const state = await welcomeState();
  const seen = () => request('PATCH', '/api/welcome', { seen: true });
  const go = () => () => { seen(); }; // the link itself opens the page (shell.js)

  const status = el('p', { class: 'empty', role: 'status' });
  const name = el('input', {
    type: 'text', class: 'detail-input', 'aria-label': 'Your name', placeholder: 'Type your name here.', maxlength: 80, value: state.name, autocomplete: 'given-name',
  });
  let timer = null;
  name.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => { await request('PATCH', '/api/welcome', { name: name.value }); status.textContent = 'Saved.'; }, 400);
  });

  const step = (href, iconName, words) => el('a', { class: 'welcome-step', href, onclick: go() },
    icon(iconName), el('span', { class: 'welcome-step-words' }, el('strong', {}, words)));

  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, state.name ? `Welcome, ${state.name}` : 'Welcome to Sovran Advisor')),
    el('section', { class: 'welcome-words', 'aria-label': 'About Sovran Advisor' },
      el('p', { class: 'welcome-lead' }, 'Your trusty companion on your Sovran Quest journey.'),
      el('p', {}, 'It sets you up for greater expansion, in your life and through the extra modules you can add to this app as you go. Use it to support your own journey of liberation and of living a whole life: a true expression of who you really are, personally, professionally and in every part of your life.')),
    el('section', { class: 'settings-part', 'aria-label': 'What to call you' },
      el('h2', { class: 'settings-title' }, 'What should your Advisor call you?'), name, status),
    el('section', { class: 'settings-part', 'aria-label': 'Your assistant' },
      el('h2', { class: 'settings-title' }, 'Your assistant'),
      state.assistant_ready
        ? el('p', { class: 'welcome-ready' }, icon('check'), ` Ready. It runs on your own ${state.provider === 'codex' ? 'ChatGPT' : 'Claude'}, on this computer.`)
        : el('p', {}, state.provider === 'codex'
          ? 'Not set up yet. Your assistant runs on ChatGPT’s Codex, signed in with your own ChatGPT account. Install Codex, sign in once, then open this page again.'
          : 'Not set up yet. Your assistant runs on your own Claude Code, signed in with your own Claude account. Install Claude Code, sign in once, then open this page again. (Using ChatGPT instead? Choose it in Settings.)')),
    el('section', { class: 'settings-part', 'aria-label': 'First steps' },
      el('h2', { class: 'settings-title' }, 'To begin'),
      el('div', { class: 'welcome-steps' },
        step('/journal', 'journal', 'Write your first journal entry'))));
}
