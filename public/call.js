// A voice call with your assistant (the Voice module, advanced/voice/3-7): a Call button in the chat. The call is a thin
// front over the chat you already have: it listens, and when you stop talking your words go to your assistant as a normal
// chat message (same tools, same permissions); it speaks a short version of the answer, and the full answer is in the chat.
//   Ears   the free voice model on this computer (Whisper, voice-local.js), or ElevenLabs realtime speech to text when
//          there is an ElevenLabs key. A pause of under a second ends your turn; speaking while it talks stops it.
//   Mouth  the free speaking voice on this computer (Piper), or ElevenLabs text to speech with a key (call.js).
//   3  the Call widget: Listening, Thinking, Speaking; whose turn; the level line; the words of the turn; End call.
//   4  a request to do something: "Working on it.", then "Done" or, for what asks first, "Shall I …? Say yes or no."
//   5  every turn measures the time from the end of your words to the first sound of the answer; opening the chat
//      warms the call (the models fetched and loaded) and the dot on Call says warming, then ready.
//   6  plain questions (what is on today, what is next, how many tasks are due) answered from your data, no model;
//      after one second with no answer, one short true line ("Let me check.").
//   7  a layer that fails says so in one line and the call goes on with what still works; each failure is in the Voice log.

import { el, icon, request } from './ui.js';
import { moduleOn, onModulesChanged } from './modules.js';
import { applyFixes } from './glossary-learn.js';
import { spokenVersion, cardSaid, asksToDo, yesOrNo, fillerFor } from './spoken.js';
import { cardWhat } from './assistant.js';

const RATE = 16_000;
const FRAME = 1600; // 100 ms
const START_FRAMES = 2; // 0.2 s of voice starts your turn
const END_FRAMES = 8; // 0.8 s of quiet ends it
const PRE_ROLL = 3; // and the 0.3 s before it starts is kept
const MAX_TURN_FRAMES = 600; // a turn is at most a minute
const BARGE_FRAMES = 4; // 0.4 s of a louder voice while it speaks stops it
const FILLER_MS = 1000;
const SLOW_MS = 45_000; // your assistant takes longer than this: it will answer in the chat
const VOICE_WAIT_MS = 12_000; // the voice service does not answer in this time: offer to go on in writing
const STATE_WORDS = { listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', paused: 'Paused', starting: 'Starting' };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const rms = (samples) => { let sum = 0; for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]; return Math.sqrt(sum / Math.max(1, samples.length)); };
const bytesToBase64 = (bytes) => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
const pcmOf = (frames) => {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const pcm = new Int16Array(total);
  let at = 0;
  for (const f of frames) for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); pcm[at++] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return pcm;
};
// A layer that did not answer in time.
const within = (ms, promise, what) => Promise.race([promise, sleep(ms).then(() => { throw Object.assign(new Error(what), { late: true }); })]);
const offline = () => navigator.onLine === false;

// Turn-taking on the microphone: a frame at a time, it says when your turn starts and ends, and when you speak over it.
export function turnTaker() {
  let floor = 0.004; // the room's own sound, learnt while nobody speaks
  let loud = 0;
  let quiet = 0;
  let inTurn = false;
  let frames = 0;
  return {
    reset() { loud = 0; quiet = 0; inTurn = false; frames = 0; },
    // level of one 100 ms frame; speaking: it is talking now. Answers 'start', 'end', 'barge' or null.
    frame(level, { speaking = false } = {}) {
      if (!inTurn && !speaking && level < floor * 2.5) floor = floor * 0.95 + level * 0.05;
      if (speaking) {
        loud = level > Math.max(0.06, floor * 6) ? loud + 1 : 0;
        return loud >= BARGE_FRAMES ? (loud = 0, 'barge') : null;
      }
      const voiced = level > Math.max(0.02, floor * 3);
      if (!inTurn) {
        loud = voiced ? loud + 1 : 0;
        if (loud >= START_FRAMES) { inTurn = true; quiet = 0; frames = loud; return 'start'; }
        return null;
      }
      frames++;
      quiet = voiced ? 0 : quiet + 1;
      if (quiet >= END_FRAMES || frames >= MAX_TURN_FRAMES) { inTurn = false; loud = 0; return 'end'; }
      return null;
    },
  };
}

export function callControls(page) {
  let call = null; // the call under way
  let warmth = 'cold'; // cold · warming · ready (the dot on Call)
  const tryMode = new URLSearchParams(location.search).get('try') === 'voice'; // Settings › Voice log › Try it

  const dot = el('span', { class: 'call-dot', 'data-warm': 'cold', 'aria-hidden': 'true' });
  const button = el('button', { type: 'button', class: 'button call-button', hidden: true, onclick: () => (call ? end() : start()) });
  const stateWord = el('strong', { class: 'call-state' });
  const whoseTurn = el('span', { class: 'call-who' });
  const levelBar = el('span', { class: 'mic-level-bar', style: 'width: 0%' });
  const words = el('span', { class: 'call-words' });
  const handoff = el('p', { class: 'call-handoff', hidden: true, role: 'status' });
  const notice = el('p', { class: 'call-notice', hidden: true, role: 'alert' });
  const endButton = el('button', { type: 'button', class: 'button button-quiet', onclick: () => end() }, 'End call');
  const widget = el('div', { class: 'call-widget', hidden: true, role: 'group', 'aria-label': 'Call' },
    el('div', { class: 'call-line' }, icon('phone'), stateWord, whoseTurn, el('span', { class: 'mic-level', 'aria-hidden': 'true' }, levelBar), words, endButton),
    handoff, notice);

  function drawButton() {
    const on = moduleOn('voice');
    button.hidden = !on;
    dot.dataset.warm = warmth;
    dot.title = { cold: '', warming: 'Warming up', ready: 'Ready' }[warmth];
    button.replaceChildren(icon('phone'), call ? 'End call' : 'Call', ...(call ? [] : [dot]));
    button.setAttribute('aria-label', call ? 'End call' : `Call your assistant${warmth === 'ready' ? ' (ready)' : warmth === 'warming' ? ' (warming up)' : ''}`);
  }
  function setState(state, who = '') {
    if (!call) return;
    call.state = state;
    widget.dataset.state = state;
    stateWord.textContent = STATE_WORDS[state] ?? state;
    whoseTurn.textContent = who;
    if (state !== 'listening') levelBar.style.width = '0%';
  }
  const showWords = (text) => { words.textContent = text ? `…${text.slice(-120)}` : ''; };
  const showHandoff = (text) => { handoff.hidden = !text; handoff.replaceChildren(...(text ? [text] : [])); };

  // ---- Warming (advanced/voice/5) ----
  let warmTimer = null;
  async function warm() {
    clearTimeout(warmTimer);
    if (!moduleOn('voice')) { warmth = 'cold'; drawButton(); return; }
    if (warmth !== 'ready') { warmth = 'warming'; drawButton(); }
    try {
      const state = await request('POST', '/api/call/warm', {});
      warmth = state.ready ? 'ready' : 'warming';
      if (!state.ready) warmTimer = setTimeout(warm, 2000);
    } catch { warmth = 'cold'; }
    drawButton();
  }
  onModulesChanged(() => { drawButton(); if (moduleOn('voice')) warm(); });
  drawButton();
  if (moduleOn('voice')) warm();

  // ---- The Voice log ----
  const log = (layer, what) => request('POST', '/api/voice-log', { layer, what, call_id: call?.id ?? '', tried: tryMode }).catch(() => {});

  // ---- The ears ----

  // The microphone, and turn-taking on it. Each frame goes to the ears of the call while it is your turn.
  async function openMic(c) {
    c.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    c.context = new AudioContext({ sampleRate: RATE });
    await c.context.audioWorklet.addModule('/dictation-worklet.js');
    const node = new AudioWorkletNode(c.context, 'dictation-capture');
    c.context.createMediaStreamSource(c.stream).connect(node);
    const taker = turnTaker();
    c.taker = taker;
    let block = new Float32Array(0);
    const recent = [];
    node.port.onmessage = (event) => {
      if (c.ended) return;
      const merged = new Float32Array(block.length + event.data.length);
      merged.set(block); merged.set(event.data, block.length);
      block = merged;
      while (block.length >= FRAME) {
        const frame = block.slice(0, FRAME);
        block = block.slice(FRAME);
        const level = rms(frame);
        const speaking = c.state === 'speaking';
        if (c.state === 'listening') levelBar.style.width = `${Math.round(Math.min(1, level * 6) * 100)}%`;
        if (c.state !== 'listening' && !speaking) { recent.length = 0; continue; }
        recent.push(frame);
        if (recent.length > PRE_ROLL + START_FRAMES) recent.shift();
        const said = taker.frame(level, { speaking });
        if (said === 'barge') { c.mouth?.stop(); setState('listening', 'You'); taker.reset(); continue; }
        if (said === 'start') { c.turn = { frames: [...recent] }; c.ear.begin?.(c.turn.frames); continue; }
        if (c.turn) {
          c.turn.frames.push(frame);
          c.ear.frame?.(frame);
          if (level > 0.02) c.turn.lastVoice = performance.now();
          if (said === 'end') { const turn = c.turn; c.turn = null; turn.endedAt = turn.lastVoice ?? performance.now(); c.onTurn(turn); }
        }
      }
    };
  }

  // The free voice model: the turn's sound sent in pieces of under 30 seconds when it ends.
  const localEar = (c) => ({
    async hear(turn) {
      const pieces = [];
      for (let i = 0; i < turn.frames.length; i += 280) pieces.push(turn.frames.slice(i, i + 280));
      const heard = [];
      for (const piece of pieces) {
        const answer = await request('POST', '/api/dictation/local', { audio: bytesToBase64(new Uint8Array(pcmOf(piece).buffer)) });
        if (answer.text) heard.push(answer.text);
      }
      return heard.join(' ');
    },
  });

  // ElevenLabs: one realtime session for the call; each turn's sound streams as it comes, and its end is a commit.
  const elevenEar = (c, session) => {
    let ws = null;
    let ready = false;
    let pending = [];
    let committed = null;
    let partial = '';
    let wait = null;
    const open = async (url) => {
      ws = new WebSocket(url);
      ws.addEventListener('message', (event) => {
        let m; try { m = JSON.parse(event.data); } catch { return; }
        if (m.message_type === 'session_started') { ready = true; for (const p of pending) ws.send(p); pending = []; }
        else if (m.message_type === 'partial_transcript') { partial = m.text ?? ''; if (c.state === 'listening') showWords(partial); }
        else if (/^committed_transcript/.test(m.message_type ?? '')) { committed = m.text ?? ''; wait?.(); }
        else if (/error|quota|rate_limited|exhausted|time_limit|unaccepted/.test(m.message_type ?? '')) c.voiceFailed(`ElevenLabs: ${m.error ?? m.message_type}`);
      });
      ws.addEventListener('close', () => { ws = null; ready = false; });
    };
    const send = (frame, commit) => {
      const pcm = pcmOf([frame]);
      const msg = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: bytesToBase64(new Uint8Array(pcm.buffer)), commit, sample_rate: RATE });
      if (ready && ws) ws.send(msg); else pending.push(msg);
    };
    open(session.url);
    return {
      begin(frames) { committed = null; partial = ''; frames.forEach((f) => send(f, false)); },
      frame(f) { send(f, false); },
      async hear() {
        if (!ws) { // the session ended (a long quiet): a new one for the next turn
          const next = await request('POST', '/api/dictation/session', {});
          await open(next.url);
          return '';
        }
        send(new Float32Array(FRAME), true);
        await within(VOICE_WAIT_MS, new Promise((done) => { wait = done; }), 'The voice service is not answering.');
        return (committed ?? partial).trim();
      },
      close() { try { ws?.close(); } catch { /* gone */ } },
    };
  };

  // ---- The mouth ----
  let player = null;
  async function speakNow(c, text, { measureFrom = null } = {}) {
    if (!text || c.ended) return;
    setState('speaking', 'Your assistant');
    showWords(text);
    const res = await within(VOICE_WAIT_MS, fetch('/api/call/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }), 'The voice service is not answering.');
    if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? 'The voice could not speak.'), { status: res.status });
    const audio = await res.arrayBuffer();
    if (c.ended) return;
    player ??= new AudioContext();
    if (player.state === 'suspended') await player.resume().catch(() => {});
    const buffer = await player.decodeAudioData(audio);
    const source = player.createBufferSource();
    source.buffer = buffer;
    source.connect(player.destination);
    const finished = new Promise((done) => { source.onended = done; });
    c.mouth = { stop: () => { try { source.stop(); } catch { /* ended */ } } };
    source.start();
    const firstSound = performance.now();
    await Promise.race([finished, sleep(buffer.duration * 1000 + 500)]); // a page with no sound device never says it ended
    c.mouth = null;
    return measureFrom == null ? null : Math.max(0, Math.round(firstSound - measureFrom));
  }
  // Said, and on a failure of the voice the words are shown and the notice offers to go on in writing.
  async function say(c, text, opts) {
    try { return await speakNow(c, text, opts); } catch (err) { c.voiceFailed(err.late ? 'The voice service is not answering.' : err.message); return null; }
  }

  // ---- One turn ----

  async function onTurn(c, turn) {
    setState('thinking', 'Your assistant');
    let heard = '';
    try {
      heard = c.fakeEar ? turn.text : await within(VOICE_WAIT_MS, c.ear.hear(turn), 'The voice service is not answering.');
    } catch (err) { c.voiceFailed(err.late ? 'The voice service is not answering.' : err.message); return; }
    heard = applyFixes(heard, c.fixes ?? []).text.trim();
    c.lastHeard = heard;
    if (!heard) { listen(c); return; }
    showWords(heard);
    const endedAt = turn.endedAt;
    // Yes or no to a card that asks first (advanced/voice/4).
    if (c.waiting) {
      const card = c.waiting;
      const answer = yesOrNo(heard);
      if (!answer) {
        if (c.askedAgain) { c.waiting = null; showHandoff(`Asks first: ${cardWhat(card)} · waiting in the chat`); await say(c, 'I will leave it waiting in the chat.'); listen(c); return; }
        c.askedAgain = true;
        await say(c, 'Say yes or no.');
        listen(c);
        return;
      }
      c.waiting = null;
      try {
        await page.act(card, answer === 'yes' ? 'apply' : 'dismiss');
        showHandoff(answer === 'yes' ? `Done: ${cardWhat(card)}` : `Not now: ${cardWhat(card)}`);
        await say(c, answer === 'yes' ? `Done. ${cardSaid(cardWhat(card))}.` : 'Okay, not now.');
      } catch (err) { await say(c, 'That did not work. It is waiting in the chat.'); showHandoff(err.message); }
      listen(c);
      return;
    }
    // Answers from your data first (advanced/voice/6).
    let routed = { source: 'assistant' };
    try { routed = await request('POST', '/api/call/route', { text: heard, conversation_id: page.conversationId() }); } catch { /* your assistant answers instead */ }
    if (routed.source === 'data') {
      await page.reload(routed.conversation_id);
      const ms = await say(c, routed.spoken, { measureFrom: endedAt });
      record(c, { conversation_id: routed.conversation_id, asked_id: routed.asked_id, answer_id: routed.answer_id, source: 'data', first_word_ms: ms });
      listen(c);
      return;
    }
    if (offline()) {
      log('network', 'The network dropped during a call; your assistant could not be asked.');
      await say(c, 'I am offline. I can still read your notes.');
      listen(c);
      return;
    }
    if (page.busy()) { // still answering the turn that went to the chat
      await say(c, 'Your assistant is still working on the last one. The answer will be in the chat.');
      listen(c);
      return;
    }
    await page.ensureConversation();
    const doing = asksToDo(heard);
    showHandoff(doing ? 'Working on it …' : '');
    let filler = '';
    let fillerSaid = null;
    let slow = false;
    let answered = false;
    if (doing) fillerSaid = say(c, 'Working on it.');
    const fillerTimer = doing ? null : setTimeout(() => { if (!answered && !c.ended) { filler = fillerFor(heard); fillerSaid = say(c, filler); } }, FILLER_MS);
    const slowTimer = setTimeout(async () => {
      if (answered || c.ended) return;
      slow = true;
      log('assistant', 'Your assistant took longer than 45 seconds; the answer went to the chat.');
      await fillerSaid;
      await say(c, 'That is taking long. I will answer in the chat.');
      listen(c);
    }, SLOW_MS);
    let answer = null;
    try { answer = await page.ask(heard, () => {}); } catch { /* shown in the chat */ }
    answered = true;
    clearTimeout(fillerTimer);
    clearTimeout(slowTimer);
    if (slow || c.ended) return;
    await fillerSaid;
    if (!answer || answer.state === 'failed') {
      if (offline()) { log('network', 'The network dropped during a call.'); await say(c, 'I am offline. I can still read your notes.'); }
      else await say(c, 'Your assistant could not answer. It says why in the chat.');
      listen(c);
      return;
    }
    const cards = answer.cards ?? [];
    const asks = cards.find((card) => card.state === 'proposed');
    const did = cards.find((card) => ['done', 'applied'].includes(card.state));
    let text;
    if (asks) {
      c.waiting = asks;
      c.askedAgain = false;
      showHandoff(`Asks first: ${cardWhat(asks)}`);
      text = `Shall I ${cardSaid(cardWhat(asks)).replace(/^./, (x) => x.toLowerCase())}? Say yes or no.`;
    } else if (doing && did) {
      showHandoff(`Done: ${cardWhat(did)}`);
      text = `Done. ${cardSaid(cardWhat(did))}.`;
    } else {
      if (doing) showHandoff('');
      text = spokenVersion(answer.text) || 'Done.';
    }
    const ms = await say(c, text, { measureFrom: endedAt });
    record(c, { conversation_id: page.conversationId(), answer_id: answer.id ?? '', source: 'assistant', filler, first_word_ms: ms, asked: true });
    listen(c);
  }

  // How the turn went, kept (call_turns); the chat is drawn again to show it.
  async function record(c, turn) {
    const { asked, ...rest } = turn;
    if (!rest.conversation_id) return;
    try {
      if (asked) { // your words are the message just before the answer
        const conv = await request('GET', `/api/conversations/${rest.conversation_id}`);
        const at = conv.messages.findIndex((m) => m.id === rest.answer_id);
        rest.asked_id = at > 0 ? conv.messages[at - 1].id : '';
      }
      await request('POST', '/api/call/turns', { call_id: c.id, engine: c.engine, warm: c.warm, ...rest, first_word_ms: rest.first_word_ms ?? null });
      if (!c.ended && page.conversationId() === rest.conversation_id && !page.busy()) await page.reload(rest.conversation_id);
    } catch { /* the turn is in the chat; only its numbers are not kept */ }
    c.turns++;
  }

  // ---- Listening, and the call ----

  function listen(c) {
    if (c.ended || c.failed) return;
    if (!c.turn) c.taker?.reset(); // speaking over it already began your turn: keep it
    setState('listening', 'You');
    showWords('');
    if (c.fakeEar) c.fakeEar().then((text) => { if (!c.ended && text != null) onTurn(c, { text, endedAt: performance.now() }); });
  }

  async function start() {
    if (call) return;
    const c = { id: crypto.randomUUID(), state: 'starting', turns: 0, warm: warmth === 'ready', ended: false };
    call = c;
    c.onTurn = (turn) => onTurn(c, turn);
    c.voiceFailed = (what) => {
      if (c.ended || c.failed) return;
      c.failed = true;
      log('voice', what);
      setState('paused', '');
      notice.hidden = false;
      notice.replaceChildren(`${what} Go on in writing?`, ' ', el('button', { type: 'button', class: 'button', onclick: () => goOnInWriting(c) }, 'Go on in writing'));
    };
    widget.hidden = false;
    notice.hidden = true;
    showHandoff('');
    drawButton();
    setState('starting', '');
    try {
      const session = await request('POST', '/api/dictation/session', {});
      c.fixes = session.fixes ?? [];
      c.engine = session.engine === 'elevenlabs' ? 'elevenlabs' : 'local';
      if (typeof window.__sovranCallEar === 'function') c.fakeEar = window.__sovranCallEar; // the tests' stand-in for a voice
      else if (tryMode) c.fakeEar = () => new Promise(() => {}); // Try it: no microphone, the voice is about to stop
      else {
        c.ear = c.engine === 'elevenlabs' ? elevenEar(c, session) : localEar(c);
        await openMic(c);
      }
    } catch (err) {
      setState('paused', '');
      notice.hidden = false;
      notice.replaceChildren(err?.name === 'NotAllowedError' ? 'The microphone is not allowed. Allow it for this page in the browser.' : err.message || 'The call could not start.');
      log('voice', err.message || 'The call could not start.');
      c.ended = true;
      setTimeout(() => { if (call === c) { call = null; drawButton(); } }, 0);
      return;
    }
    listen(c);
    // Settings › Voice log › Try it: a call where the voice service stops.
    if (tryMode) setTimeout(() => { if (call === c) c.voiceFailed('The voice service is not answering.'); }, 1500);
  }

  // The voice failed: the call ends, its turns stay in the chat with a line, and the words you were saying wait in the box.
  async function goOnInWriting(c) {
    const words = c.turn ? '' : c.lastHeard ?? '';
    const conversationId = page.conversationId() ?? await page.ensureConversation();
    await request('POST', '/api/call/turns', { call_id: c.id, conversation_id: conversationId, kind: 'written', engine: c.engine, warm: c.warm }).catch(() => {});
    end();
    await page.reload(conversationId);
    page.writeIn(words);
  }

  function end() {
    const c = call;
    if (!c) return;
    c.ended = true;
    c.mouth?.stop();
    c.ear?.close?.();
    c.stream?.getTracks().forEach((t) => t.stop());
    c.context?.close().catch(() => {});
    call = null;
    widget.hidden = true;
    drawButton();
  }

  window.addEventListener('offline', () => { if (call) log('network', 'The network dropped during a call.'); });

  if (tryMode && moduleOn('voice')) setTimeout(start, 300);

  return { button, widget, end, active: () => Boolean(call), start };
}
