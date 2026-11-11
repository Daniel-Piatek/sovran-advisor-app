// Modules (Settings › Modules, advanced/people/1): which optional parts of the app are on.
// Read once when the app opens and again when a switch changes; a module that is off hides
// its menus and chips and keeps everything it made. A module is on until it is switched off.

import { request } from './ui.js';

let modules = [];
const listeners = [];
// Something that shows a module's parts (the sidebar) asks to hear when a switch changes.
export const onModulesChanged = (fn) => listeners.push(fn);

// The page's CSS reads the switch too (a mention's face goes when People in depth is off).
function mark() {
  document.documentElement.dataset.peoplePlus = moduleOn('people-plus') ? 'on' : 'off';
}

export function setModules(list) {
  modules = list;
  mark();
  for (const fn of listeners) fn();
  return modules;
}

export async function loadModules() {
  try { return setModules(await request('GET', '/api/modules')); } catch { mark(); return modules; }
}

export const moduleOn = (id) => modules.find((m) => m.id === id)?.on ?? true;
export const switchModule = async (id, on) => setModules(await request('PATCH', '/api/modules', { id, on }));
// A module marked hidden (not ready to offer yet) stays out of the Settings list; it is off.
export const listedModules = () => modules.filter((m) => !m.hidden);
