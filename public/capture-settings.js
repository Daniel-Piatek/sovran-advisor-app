// Settings › Capture from anywhere (Tasks in depth 6): the address that takes a capture from outside the app, a bookmarklet for
// a browser, how to send from a phone's share sheet, and the devices that may, each with when it was last used and Revoke.
// A device's token is shown once, when it is made, and is kept only in the system's key store.

import { el, icon, request, timeAgo } from './ui.js';
import { fold } from './fold.js';

const KIND_WORDS = { browser: 'Browser', phone: 'Phone', other: 'Other app' };

// A bookmarklet that sends the page you are on (its title, or the words you selected, and its address).
export function bookmarkletFor(address, token) {
  const code = `(async()=>{try{const r=await fetch(${JSON.stringify(`${address}/capture`)},{method:'POST',headers:{'Content-Type':'application/json','X-Capture-Token':${JSON.stringify(token)}},body:JSON.stringify({text:String(getSelection()).trim()||document.title,link:location.href})});alert(r.ok?'Kept in your Inbox.':'Not kept ('+r.status+').')}catch(e){alert('Not kept: is the app running?')}})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function captureSection() {
  const address = location.origin;
  const list = el('div', { class: 'capture-devices', role: 'list', 'aria-label': 'Devices' });
  const folded = fold('capture-devices', 'Devices', list);
  const fresh = el('div', { class: 'capture-fresh', 'aria-live': 'polite' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const name = el('input', { class: 'detail-input', 'aria-label': 'Device name', placeholder: 'A name, like “Phone” or “Work browser”', autocomplete: 'off', maxlength: 60, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
  const kind = el('select', { class: 'detail-input', 'aria-label': 'Kind of device' },
    ...Object.entries(KIND_WORDS).map(([value, label]) => el('option', { value }, value === 'browser' ? 'Browser (a bookmarklet)' : value === 'phone' ? 'Phone (its share sheet)' : label)));

  async function load() {
    let devices = [];
    try { devices = await request('GET', '/api/capture/devices'); } catch { list.replaceChildren(el('p', { class: 'empty' }, "The devices couldn't be loaded. Is the app still running?")); return; }
    folded.say(devices.length, ['device', 'devices']);
    list.replaceChildren(...(devices.length ? devices.map((d) => el('div', { class: 'capture-device', role: 'listitem', 'data-device': d.name },
      el('span', { class: 'capture-device-name' }, el('strong', {}, d.name), ` · ${KIND_WORDS[d.kind]}`),
      el('span', { class: 'capture-device-used' }, d.last_used_at ? `Last used ${timeAgo(d.last_used_at)} · ${d.uses} ${d.uses === 1 ? 'capture' : 'captures'}` : 'Never used'),
      el('button', {
        type: 'button', class: 'button button-quiet', 'aria-label': `Revoke ${d.name}`,
        onclick: async () => {
          try { await request('DELETE', `/api/capture/devices/${d.id}`); fresh.replaceChildren(); load(); } catch (err) { problem.textContent = err.message; }
        },
      }, 'Revoke')))
      : [el('p', { class: 'empty' }, 'No device yet. Add one below for each browser or phone you want to capture from.')]));
  }

  async function add() {
    problem.textContent = '';
    try {
      const made = await request('POST', '/api/capture/devices', { name: name.value, kind: kind.value });
      name.value = '';
      showToken(made);
      load();
    } catch (err) { problem.textContent = err.message; }
  }

  function showToken({ device, token }) {
    const copy = el('button', { type: 'button', class: 'button', onclick: async () => { try { await navigator.clipboard.writeText(token); copy.textContent = 'Copied'; } catch { copy.textContent = 'Not copied: select it by hand'; } } }, 'Copy token');
    fresh.replaceChildren(el('div', { class: 'capture-token-box', role: 'group', 'aria-label': `Token for ${device.name}` },
      el('p', {}, el('strong', {}, `Token for ${device.name}`), ' — shown once. It is kept only in this computer’s key store; if you lose it, revoke the device and add it again.'),
      el('code', { class: 'capture-token' }, token), copy,
      device.kind === 'browser'
        ? el('p', {}, 'Drag this to your bookmarks bar, then press it on any page to keep it: ',
          el('a', { class: 'button', href: bookmarkletFor(address, token), onclick: (e) => e.preventDefault(), draggable: 'true', 'data-bookmarklet': device.name }, icon('link'), ' Keep in app'))
        : el('p', { class: 'capture-hint' }, 'On an iPhone: Shortcuts › a share sheet shortcut with “Get contents of URL”: POST, JSON body with text and link, header X-Capture-Token. On Android: HTTP Shortcuts, the same, or send from any app that can POST. The address is below.')));
  }

  load();
  return el('section', { class: 'settings-part', 'aria-label': 'Capture from anywhere' },
    el('h2', { class: 'settings-title' }, 'Capture from anywhere'),
    el('p', { class: 'empty' }, 'One address takes a capture from outside the app: a bookmarklet in your browser, your phone’s share sheet, any app that can send a line of text. It lands in the Inbox, with the device it came from. Each device has its own token, so you can see which one sent what and revoke a lost one alone.'),
    el('p', {}, 'Address: ', el('code', {}, `${address}/capture`), el('span', { class: 'capture-hint' }, ' · POST, JSON { "text": "…", "link": "https://…" }, header X-Capture-Token. A phone reaches it only through Tailscale, which is off now.')),
    folded, problem, fresh,
    el('div', { class: 'capture-add' }, name, kind, el('button', { type: 'button', class: 'button', onclick: add }, icon('plus'), 'Add a device')));
}
