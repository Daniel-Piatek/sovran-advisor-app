// Settings › Voice and Settings › Voice log (the Voice module, advanced/voice/3, 5 and 7): the voice a call speaks with and
// its speed; how fast calls answer (the median time to the first word of the last 20 calls, the last call, a bar a call);
// and every failure of a layer of a call, with a way to try the voice failing on purpose.

import { el, request, clockTime, shortDate } from './ui.js';
import { firstWordWords } from './spoken.js';
import { fold } from './fold.js';

const SPEEDS = [{ value: 0.85, label: 'Slower' }, { value: 1, label: 'Normal' }, { value: 1.15, label: 'Faster' }];
const MODEL_WORDS = { ready: 'here', getting: 'getting it', missing: 'not here yet', failed: 'could not be fetched', unavailable: 'can’t run here' };

export function voiceSection() {
  const status = el('p', { class: 'empty', role: 'status' });
  const voices = el('div', {});
  const speeds = el('div', { class: 'switch', role: 'group', 'aria-label': 'Speed' });
  const numbers = el('div', { 'aria-label': 'How fast calls answer' });

  async function save(change) {
    try { draw(await request('PUT', '/api/call/settings', change)); } catch (err) { status.textContent = err.message; }
  }

  function draw(s) {
    status.textContent = s.engine === 'elevenlabs'
      ? 'Calls listen and speak with ElevenLabs (your key). Your voice goes to ElevenLabs only during a call.'
      : `Calls listen and speak on this computer, free: the voice model is ${MODEL_WORDS[s.ears.state] ?? s.ears.state}${s.ears.percent != null ? ` (${s.ears.percent}%)` : ''}, the speaking voice ${MODEL_WORDS[s.mouth.state] ?? s.mouth.state}${s.mouth.percent != null ? ` (${s.mouth.percent}%)` : ''}.`;
    voices.replaceChildren(s.voices.length > 1
      ? el('select', { class: 'detail-input', 'aria-label': 'Voice', onchange: (event) => save({ voice: event.target.value }) },
        ...s.voices.map((v) => el('option', { value: v.id, ...(v.id === s.voice ? { selected: '' } : {}) }, v.name)))
      : el('span', {}, s.voices[0]?.name ?? 'No voice yet'));
    speeds.replaceChildren(...SPEEDS.map((sp) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(Math.abs(sp.value - s.speed) < 0.01), onclick: () => save({ speed: sp.value }),
    }, sp.label)));
  }

  async function drawNumbers() {
    let stats;
    try { stats = await request('GET', '/api/call/stats'); } catch { return; }
    if (!stats.calls.length) { numbers.replaceChildren(el('p', { class: 'empty' }, 'No call yet. Press Call in your assistant’s chat.')); return; }
    const top = Math.max(...stats.calls.map((c) => c.median_ms), 1);
    numbers.replaceChildren(
      el('p', {}, `Median of your last ${stats.calls.length} ${stats.calls.length === 1 ? 'call' : 'calls'}: `, el('span', { class: 'metric-chip' }, firstWordWords(stats.median_ms)),
        ' · last call: ', el('span', { class: 'metric-chip' }, firstWordWords(stats.last_ms))),
      el('div', { class: 'call-bars', role: 'img', 'aria-label': `The time to the first word of each call, the oldest first: ${[...stats.calls].reverse().map((c) => firstWordWords(c.median_ms)).join(', ')}` },
        ...[...stats.calls].reverse().map((c, i, all) => el('span', {
          class: `call-bar${i === all.length - 1 ? ' is-last' : ''}`, title: `${shortDate(c.at)} ${clockTime(c.at)} · ${firstWordWords(c.median_ms)}${c.warm ? '' : ' · cold start'}`,
          style: `height: ${Math.max(8, Math.round((c.median_ms / top) * 100))}%`,
        }))));
  }

  request('GET', '/api/call/settings').then(draw).catch(() => { status.textContent = 'The voice settings couldn’t be loaded.'; });
  drawNumbers();
  return el('section', { class: 'settings-part', 'aria-label': 'Voice' },
    el('h2', { class: 'settings-title' }, 'Voice'),
    el('p', { class: 'empty' }, 'Calls with your assistant: press Call in its chat, talk, and it answers out loud. Every turn is kept in the chat.'),
    status,
    el('div', { class: 'permission-row' }, el('span', { class: 'permission-name' }, 'Voice'), voices),
    el('div', { class: 'permission-row' }, el('span', { class: 'permission-name' }, 'Speed'), speeds),
    el('h3', { class: 'settings-title' }, 'First word'),
    el('p', { class: 'empty' }, 'The time from the end of your words to the first sound of the answer.'),
    numbers);
}

const LAYER_WORDS = { voice: 'Voice service', network: 'Network', assistant: 'Your assistant' };

export function voiceLogSection() {
  const list = el('ol', { class: 'activity-log', 'aria-label': 'Voice log' });
  const folded = fold('voice-log', 'Every time', list);
  folded.say(0, ['time', 'times']);
  request('GET', '/api/voice-log').then((rows) => {
    folded.say(rows.length, ['time', 'times'], rows[0] ? `latest ${shortDate(rows[0].created_at)} ${clockTime(rows[0].created_at)}` : '');
    list.replaceChildren(...(rows.length ? rows.map((r) => el('li', { class: 'activity-row' },
      el('span', { class: 'activity-when' }, `${shortDate(r.created_at)} ${clockTime(r.created_at)}`),
      el('span', {}, el('strong', {}, LAYER_WORDS[r.layer] ?? r.layer), ` · ${r.what}${r.tried ? ' (tried on purpose)' : ''}`)))
      : [el('li', { class: 'empty' }, 'Nothing has failed on a call.')]));
  }).catch(() => {});
  return el('section', { class: 'settings-part', 'aria-label': 'Voice log' },
    el('h2', { class: 'settings-title' }, 'Voice log'),
    el('p', { class: 'empty' }, 'When a part of a call fails (the voice service, the network, your assistant), the call says so and goes on with what still works. Each time is here.'),
    el('p', {}, el('a', { class: 'button', href: '/assistant?try=voice' }, 'Try it: a call where the voice service stops')),
    folded);
}
