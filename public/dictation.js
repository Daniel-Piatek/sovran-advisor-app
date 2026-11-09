// Dictation (the Voice module, advanced/voice/1). Hold the dictation key (Right Option unless
// Settings says another) in any field, speak, let go: the words are written at the cursor. The
// Mic pill at the foot of the page shows what is going on: which key to hold (idle), the words
// as they come (listening), writing, and where they went (done). Its mic button listens hands-free
// until pressed again. The sound goes to ElevenLabs speech-to-text (Scribe, realtime) over a
// WebSocket whose address, with a short-lived token, comes from this app's server (the key never
// leaves it). Every dictation is kept as text; with no field to take it, the words are copied
// to the clipboard and marked Clipboard only.

import { el, icon, request } from './ui.js';
import { moduleOn, onModulesChanged } from './modules.js';
import { proposeFix, regionOf, applyFixes } from './glossary-learn.js';
import { undoBar } from './ui.js';

const SAMPLE_RATE = 16_000;
const CHUNK = 1600; // 100 ms
const HOLD_MS = 180; // a tap on the key is not a dictation
const COMMIT_WAIT_MS = 6000;
const DONE_MS = 4500;
const KEY_WORDS = { AltRight: 'Right ⌥', MetaRight: 'Right ⌘', ControlRight: 'Right ^' };

let holdKey = 'AltRight';
let state = 'idle'; // idle · listening · writing · done · problem
let words = ''; // the words so far, or the message of done and problem
let level = 0;
let handsFree = false;
let lastField = null;
let run = null; // the dictation under way
let doneTimer = null;

// ---- The pill ----

const idleButton = el('button', { type: 'button', class: 'mic-pill', 'data-state': 'idle', onmousedown: (event) => event.preventDefault(), onclick: () => toggleHandsFree() });
const live = el('div', { class: 'mic-pill mic-pill-live', 'data-state': 'listening', role: 'status', 'aria-live': 'polite', hidden: true });
document.body.append(live);

export const micPill = () => idleButton;

function draw() {
  const on = moduleOn('voice');
  idleButton.hidden = !on || state !== 'idle';
  live.hidden = !on || state === 'idle';
  idleButton.replaceChildren(icon('mic'), el('span', {}, `Hold ${KEY_WORDS[holdKey]} to dictate`));
  idleButton.setAttribute('aria-label', `Dictate hands-free. Or hold ${KEY_WORDS[holdKey]} in a field`);
  live.dataset.state = state;
  const stop = state === 'listening' && handsFree ? [el('button', { type: 'button', class: 'button button-quiet mic-stop', onmousedown: (event) => event.preventDefault(), onclick: () => finish() }, 'Done')] : [];
  live.replaceChildren(icon('mic'), ...(state === 'listening' ? [el('span', { class: 'mic-level', 'aria-hidden': 'true' }, el('span', { class: 'mic-level-bar', style: `width: ${Math.round(Math.min(1, level) * 100)}%` }))] : []),
    el('span', { class: 'mic-words' }, state === 'listening' ? (words ? `…${words.slice(-90)}` : 'Listening…') : state === 'writing' ? 'Writing…' : words), ...stop);
}

function setState(next, text = '') {
  state = next;
  words = text;
  if (next !== 'listening') level = 0;
  draw();
}

function rest(after = DONE_MS) {
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { if (state === 'done' || state === 'problem') setState('idle'); }, after);
}

onModulesChanged(draw);
draw();
request('GET', '/api/dictation/settings').then((s) => { holdKey = s.hold_key; draw(); }).catch(() => {});
// Settings changed the hold key.
document.addEventListener('dictation-settings', (event) => { holdKey = event.detail.hold_key; draw(); });

// ---- Fields ----

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', '']);
export function editableOf(node) {
  if (!(node instanceof Element)) return null;
  if (node.matches('textarea') && !node.disabled && !node.readOnly) return node;
  if (node.matches('input') && !node.disabled && !node.readOnly && TEXT_INPUTS.has(node.getAttribute('type') ?? '')) return node;
  const rich = node.closest('[contenteditable="true"]');
  return rich ?? null;
}

document.addEventListener('focusin', (event) => { const field = editableOf(event.target); if (field) lastField = field; });

const describe = (field) => {
  const label = field.getAttribute('aria-label') || field.getAttribute('placeholder') || (field.matches('input, textarea') ? 'Field' : 'Text');
  return `${label} · ${document.title}`;
};

export const textOf = (field) => (field.matches('input, textarea') ? field.value : field.textContent);

// The few letters before and after the cursor: later they find where the dictated words are.
function around(field) {
  if (field.matches('input, textarea')) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    return { pre: field.value.slice(Math.max(0, start - 30), start), post: field.value.slice(end, end + 30) };
  }
  const selection = getSelection();
  if (!selection.rangeCount) return { pre: '', post: '' };
  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(field);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(field);
  after.setStart(range.endContainer, range.endOffset);
  return { pre: before.toString().slice(-30), post: after.toString().slice(0, 30) };
}

function insert(field, text) {
  field.focus({ preventScroll: true });
  const anchors = around(field);
  if (field.matches('input, textarea')) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const before = field.value[start - 1];
    field.setRangeText((start > 0 && before && !/\s/.test(before) ? ' ' : '') + text, start, end, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return anchors;
  }
  const range = getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
  const previous = range && range.startContainer.nodeType === 3 && range.startOffset > 0 ? range.startContainer.data[range.startOffset - 1] : '';
  document.execCommand('insertText', false, (previous && !/\s/.test(previous) ? ' ' : '') + text);
  return anchors;
}

// ---- Learning from a correction ----

const WATCH_MS = 3 * 60_000; // the field is remembered for three minutes
const SETTLE_MS = 1500; // and looked at when you stop typing for a moment
let watching = null;
let proposalBar = null;

function stopWatching() {
  if (!watching) return;
  clearTimeout(watching.timer);
  clearTimeout(watching.expires);
  watching.field.removeEventListener('input', watching.onInput);
  watching = null;
}

function watch(field, dictated, anchors) {
  stopWatching();
  const mine = { field, dictated, ...anchors };
  mine.onInput = () => {
    clearTimeout(mine.timer);
    mine.timer = setTimeout(() => look(mine), SETTLE_MS);
  };
  mine.expires = setTimeout(() => { if (watching === mine) stopWatching(); }, WATCH_MS);
  field.addEventListener('input', mine.onInput);
  watching = mine;
}

function look(mine) {
  if (watching !== mine || !mine.field.isConnected) { stopWatching(); return; }
  const region = regionOf(textOf(mine.field), mine.pre, mine.post);
  const fix = region == null ? null : proposeFix(mine.dictated, region);
  if (!fix) return;
  stopWatching();
  propose(fix);
}

// "You wrote Nordlicht where it heard North light. Add it to the glossary?" with Add and Not now.
function propose(fix) {
  proposalBar?.remove();
  const bar = el('div', { class: 'undo-bar glossary-proposal', role: 'status' },
    el('span', {}, `You wrote “${fix.term}” where it heard “${fix.heard_as}”. Add it to the glossary?`),
    el('button', {
      type: 'button', class: 'button', onclick: async () => {
        try {
          const made = await request('POST', '/api/glossary', { term: fix.term, heard_as: fix.heard_as, learned: true });
          const done = undoBar(`Added to your glossary: “${fix.heard_as}” is written “${fix.term}” from now on.`, async () => { await request('DELETE', `/api/glossary/${made.id}`); });
          done.classList.add('glossary-proposal');
          bar.replaceWith(done);
          proposalBar = done;
        } catch (err) { bar.firstChild.textContent = err.message; }
      },
    }, 'Add'),
    el('button', { type: 'button', class: 'button button-quiet', onclick: () => bar.remove() }, 'Not now'));
  proposalBar = bar;
  document.body.append(bar);
}

// ---- One dictation ----

const bytesToBase64 = (bytes) => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };

async function begin({ field, hands }) {
  if (state === 'listening' || state === 'writing') return;
  clearTimeout(doneTimer);
  handsFree = hands;
  run = { field, partial: '', committed: '', pending: [], ready: false, stopped: false, cancelled: false, queue: [], context: null, stream: null, ws: null, finishWait: null };
  const mine = run;
  setState('listening', '');
  try {
    const session = await request('POST', '/api/dictation/session', {});
    if (mine.cancelled) return;
    mine.fixes = session.fixes ?? [];
    mine.ws = new WebSocket(session.url);
    mine.ws.addEventListener('message', (event) => onMessage(mine, event));
    mine.ws.addEventListener('close', () => { mine.closed = true; mine.finishWait?.(); });
    mine.ws.addEventListener('error', () => { if (!mine.ready) problem(mine, 'The speech service could not be reached.'); });
    mine.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (mine.cancelled) { teardown(mine); return; }
    mine.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await mine.context.audioWorklet.addModule('/dictation-worklet.js');
    const source = mine.context.createMediaStreamSource(mine.stream);
    const node = new AudioWorkletNode(mine.context, 'dictation-capture');
    let block = new Float32Array(0);
    node.port.onmessage = (event) => {
      if (mine.stopped) return;
      const merged = new Float32Array(block.length + event.data.length);
      merged.set(block); merged.set(event.data, block.length);
      block = merged;
      while (block.length >= CHUNK) { sendChunk(mine, block.subarray(0, CHUNK), false); block = block.slice(CHUNK); }
      mine.tail = block;
    };
    source.connect(node);
    mine.node = node;
  } catch (err) {
    problem(mine, err?.status ? err.message : err?.name === 'NotAllowedError' ? 'The microphone is not allowed. Allow it for this page in the browser.' : 'Dictation could not start.');
  }
}

function sendChunk(mine, samples, commit) {
  let sum = 0;
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; sum += s * s; }
  level = Math.sqrt(sum / Math.max(1, samples.length)) * 6;
  draw();
  const message = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: bytesToBase64(new Uint8Array(pcm.buffer)), commit, sample_rate: SAMPLE_RATE });
  if (mine.ready) mine.ws.send(message); else mine.pending.push(message);
}

function onMessage(mine, event) {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.message_type === 'session_started') {
    mine.ready = true;
    for (const queued of mine.pending) mine.ws.send(queued);
    mine.pending = [];
  } else if (message.message_type === 'partial_transcript') {
    mine.partial = message.text ?? '';
    if (state === 'listening') { words = mine.partial; draw(); }
  } else if (message.message_type === 'committed_transcript' || message.message_type === 'committed_transcript_with_timestamps') {
    mine.committed = message.text ?? '';
    mine.finishWait?.();
  } else if (/error|quota_exceeded|rate_limited|queue_overflow|resource_exhausted|session_time_limit_exceeded|commit_throttled|unaccepted_terms|invalid_request|chunk_size_exceeded|insufficient_audio_activity/.test(message.message_type ?? '') && message.message_type !== 'warning') {
    problem(mine, `ElevenLabs: ${message.error ?? message.message_type}`);
  }
}

function teardown(mine) {
  mine.stopped = true;
  try { mine.node?.disconnect(); } catch { /* gone */ }
  mine.stream?.getTracks().forEach((track) => track.stop());
  mine.context?.close().catch(() => {});
  try { mine.ws?.close(); } catch { /* gone */ }
}

function problem(mine, message) {
  if (mine.cancelled || run !== mine) return;
  mine.cancelled = true;
  teardown(mine);
  run = null;
  setState('problem', message);
  rest(7000);
}

export function cancel() {
  if (!run) return;
  const mine = run;
  mine.cancelled = true;
  teardown(mine);
  run = null;
  setState('idle');
}

// Let go: send what is left with a commit, wait for the final words, write them.
export async function finish() {
  const mine = run;
  if (!mine || mine.stopped || mine.cancelled) return;
  mine.stopped = true;
  setState('writing');
  mine.node?.disconnect();
  mine.stream?.getTracks().forEach((track) => track.stop());
  const last = mine.tail?.length ? mine.tail : new Float32Array(CHUNK); // the commit rides on the last chunk (100 ms of silence if none is left)
  sendChunk(mine, last, true);
  await new Promise((resolve) => { mine.finishWait = resolve; setTimeout(resolve, COMMIT_WAIT_MS); });
  if (mine.cancelled || run !== mine) return;
  const text = (mine.committed || mine.partial).trim();
  teardown(mine);
  run = null;
  await deliver(mine, text);
}

async function deliver(mine, heard) {
  if (!heard) { setState('done', 'Heard nothing.'); rest(); return; }
  const { text, fixed } = applyFixes(heard, mine.fixes ?? []);
  const count = text.split(/\s+/).length;
  const field = mine.field && mine.field.isConnected ? mine.field : null;
  let outcome = 'clipboard';
  let wentTo = '';
  if (field) {
    const anchors = insert(field, text);
    outcome = 'inserted';
    wentTo = describe(field);
    watch(field, text, anchors);
  } else {
    try { await navigator.clipboard.writeText(text); } catch { /* the history keeps it anyway */ }
  }
  try { await request('POST', '/api/dictations', { text, went_to: wentTo, outcome, fixed }); } catch { /* not kept: the words are in place or on the clipboard */ }
  const fixedWords = fixed ? ` · your glossary fixed ${fixed}` : '';
  setState('done', (outcome === 'inserted' ? `Wrote ${count} ${count === 1 ? 'word' : 'words'} in ${wentTo}` : `No field had the focus: ${count} ${count === 1 ? 'word' : 'words'} copied to the clipboard`) + fixedWords);
  rest();
}

// ---- Keys ----

let holdTimer = null;
let holding = false; // the key is down and a dictation was started by it

function toggleHandsFree() {
  if (state === 'listening' && handsFree) { finish(); return; }
  if (state === 'idle' || state === 'done' || state === 'problem') begin({ field: lastField?.isConnected ? lastField : null, hands: true });
}

document.addEventListener('keydown', (event) => {
  if (!moduleOn('voice')) return;
  if (event.code === holdKey) {
    if (event.repeat || state === 'listening' || state === 'writing') return;
    const field = editableOf(document.activeElement);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holdTimer = null; holding = true; begin({ field, hands: false }); }, HOLD_MS);
    return;
  }
  // Another key while it is held: that was a key combination (Option and a letter), not a dictation.
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (holding && state === 'listening') { holding = false; cancel(); return; }
  if (event.key === 'Escape' && state === 'listening') { event.preventDefault(); cancel(); }
}, true);

document.addEventListener('keyup', (event) => {
  if (event.code !== holdKey) return;
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; return; }
  if (holding) { holding = false; finish(); }
}, true);

window.addEventListener('blur', () => { if (holding) { holding = false; cancel(); } clearTimeout(holdTimer); holdTimer = null; });
