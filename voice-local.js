// The free voice models (Dictation and calls without an ElevenLabs key), run inside this app by sherpa-onnx
// (an optional package: only the piece for this computer's system is installed). The voice never leaves the
// computer and it costs nothing.
//   ears   Whisper "base English", the same model the owner uses on their own computer: speech to text.
//   mouth  Piper "Alba" (British English, medium): text to speech, for a call's answers (advanced/voice/3).
//
// The models are not part of the download: each is fetched once when it is first needed (from the sherpa-onnx
// releases on GitHub), unpacked with the system's own `tar` (Mac and Windows 10+ have it), and kept in
// data/voice-model/. Of Whisper only the small ("int8") pieces are kept.
//
// Whisper hears a piece of up to 30 seconds at a time: the page sends longer dictations in pieces.
// For the tests: VOICE_FAKE_TRANSCRIPT stands in for the ears (no download, no engine): it "hears" that text
// (a JSON list of texts is heard one after the other); VOICE_FAKE_SPEECH stands in for the mouth (a short tone).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
export const MODELS = {
  ears: {
    name: 'sherpa-onnx-whisper-base.en', url: `${RELEASES}/asr-models/sherpa-onnx-whisper-base.en.tar.bz2`, envUrl: 'VOICE_MODEL_URL',
    keep: ['base.en-encoder.int8.onnx', 'base.en-decoder.int8.onnx', 'base.en-tokens.txt'], size: 'about 200 MB', label: 'free voice model',
  },
  mouth: {
    name: 'vits-piper-en_GB-alba-medium', url: `${RELEASES}/tts-models/vits-piper-en_GB-alba-medium.tar.bz2`, envUrl: 'VOICE_SPEAKER_URL',
    keep: ['en_GB-alba-medium.onnx', 'tokens.txt', 'espeak-ng-data'], size: 'about 70 MB', label: 'free speaking voice',
  },
};
export const SAMPLE_RATE = 16_000;
export const MAX_PIECE_SECONDS = 30;

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const modelDir = (dataDir, which) => path.join(dataDir, 'voice-model', MODELS[which].name);
const fakeOf = (which, env) => (which === 'ears' ? env.VOICE_FAKE_TRANSCRIPT : env.VOICE_FAKE_SPEECH);
const faked = (which, env) => fakeOf(which, env) !== undefined;

// ---- The engine (the optional package) ----

let engine; // undefined: not looked for yet · null: not installed on this computer
function loadEngine() {
  if (engine !== undefined) return engine;
  try { engine = createRequire(import.meta.url)('sherpa-onnx-node'); } catch { engine = null; }
  return engine;
}

// ---- The models on disk, and getting them ----

const getting = new Map(); // `${dataDir}|${which}` -> { received, total, promise, error }

export const modelReady = (dataDir, which = 'ears') => MODELS[which].keep.every((f) => fs.existsSync(path.join(modelDir(dataDir, which), f)));

// { state: ready | getting | missing | failed | unavailable, percent?, message? }
export function localStatus(dataDir, env = process.env, which = 'ears') {
  if (faked(which, env)) return { state: 'ready' };
  if (!loadEngine()) return { state: 'unavailable', message: `The ${MODELS[which].label} can’t run on this computer: its engine (sherpa-onnx) is not installed. Ask Claude to “update Sovran Advisor”, or use an ElevenLabs key.` };
  if (modelReady(dataDir, which)) return { state: 'ready' };
  const job = getting.get(`${dataDir}|${which}`);
  if (job && !job.error) return { state: 'getting', percent: job.total ? Math.floor((job.received / job.total) * 100) : 0 };
  if (job?.error) return { state: 'failed', message: job.error };
  return { state: 'missing' };
}

function untar(archive, into, members) {
  return new Promise((resolve, reject) => {
    // bsdtar (Mac, Windows) and GNU tar both read .tar.bz2 with -j, and take the members (files or folders) to keep.
    const child = spawn('tar', ['-xjf', archive, '-C', into, ...members], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar stopped (${code}): ${err.slice(-200)}`))));
  });
}

// Starts getting a model once (later calls join the same download). Resolves when it is ready.
export function prepareLocal(dataDir, { env = process.env, fetcher = fetch, which = 'ears' } = {}) {
  const model = MODELS[which];
  if (faked(which, env) || modelReady(dataDir, which)) return Promise.resolve();
  if (!loadEngine()) return Promise.reject(fail(409, localStatus(dataDir, env, which).message, 'no_engine'));
  const key = `${dataDir}|${which}`;
  const running = getting.get(key);
  if (running && !running.error) return running.promise;
  const job = { received: 0, total: 0, error: null };
  const root = path.join(dataDir, 'voice-model');
  const part = path.join(root, `${model.name}.tar.bz2.part`);
  job.promise = (async () => {
    const unpack = path.join(root, `${model.name}.unpacking`);
    fs.mkdirSync(root, { recursive: true });
    fs.rmSync(unpack, { recursive: true, force: true });
    let res;
    try { res = await fetcher(env[model.envUrl] || model.url, { redirect: 'follow' }); } catch { throw new Error(`The ${model.label} could not be downloaded. Is this computer online?`); }
    if (!res.ok || !res.body) throw new Error(`The ${model.label} could not be downloaded (${res.status}).`);
    job.total = Number(res.headers.get('content-length')) || 0;
    const counted = Readable.fromWeb(res.body);
    counted.on('data', (chunk) => { job.received += chunk.length; });
    await pipeline(counted, fs.createWriteStream(part));
    fs.mkdirSync(unpack, { recursive: true });
    try { await untar(part, unpack, model.keep.map((m) => `${model.name}/${m}`)); } catch (err) { throw new Error(`The ${model.label} could not be unpacked. ${err.message}`); }
    fs.rmSync(modelDir(dataDir, which), { recursive: true, force: true });
    fs.renameSync(path.join(unpack, model.name), modelDir(dataDir, which));
    fs.rmSync(unpack, { recursive: true, force: true });
    fs.rmSync(part, { force: true });
  })().then(() => { getting.delete(key); }, (err) => {
    job.error = err.message;
    fs.rmSync(part, { force: true });
    throw fail(502, err.message, 'model_failed');
  });
  job.promise.catch(() => {}); // the status says what went wrong
  getting.set(key, job);
  return job.promise;
}

// ---- Hearing ----

const recognizers = new Map(); // dataDir -> Promise<OfflineRecognizer>
function recognizer(dataDir) {
  if (!recognizers.has(dataDir)) {
    const dir = modelDir(dataDir, 'ears');
    const [encoder, decoder, tokens] = MODELS.ears.keep.map((f) => path.join(dir, f));
    const made = loadEngine().OfflineRecognizer.createAsync({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: { whisper: { encoder, decoder }, tokens, numThreads: 4, provider: 'cpu' },
    });
    made.catch(() => recognizers.delete(dataDir));
    recognizers.set(dataDir, made);
  }
  return recognizers.get(dataDir);
}

// Whisper writes these for silence or noise; they are not words.
const NOT_WORDS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;
export const cleanText = (text) => String(text ?? '').replace(NOT_WORDS, ' ').replace(/\s+/g, ' ').trim();

// The stand-in's words: one text, or a list heard one after the other (the last one again after that).
let fakeTurn = 0;
function fakeWords(env) {
  const raw = String(env.VOICE_FAKE_TRANSCRIPT);
  if (!raw.startsWith('[')) return raw;
  const list = JSON.parse(raw);
  return list[Math.min(fakeTurn++, list.length - 1)] ?? '';
}

// samples: 16 kHz mono, -1..1, at most 30 seconds. The words, or '' for silence.
export async function hearPiece(dataDir, samples, { env = process.env } = {}) {
  if (samples.length > SAMPLE_RATE * MAX_PIECE_SECONDS) throw fail(400, `A piece is at most ${MAX_PIECE_SECONDS} seconds.`);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const loud = Math.sqrt(sum / Math.max(1, samples.length));
  if (samples.length < SAMPLE_RATE * 0.2 || loud < 0.003) return ''; // too short, or silence: Whisper would make words up
  if (faked('ears', env)) return cleanText(fakeWords(env));
  if (!modelReady(dataDir, 'ears')) throw fail(409, 'The free voice model is not here yet.', 'model_missing');
  const rec = await recognizer(dataDir);
  const stream = rec.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  await rec.decodeAsync(stream);
  return cleanText(rec.getResult(stream).text);
}

// The page sends 16-bit sound as base64 (JSON, like every other request here).
export function samplesOf(base64) {
  if (typeof base64 !== 'string' || !base64) throw fail(400, 'audio is base64 16-bit sound.');
  const bytes = Buffer.from(base64, 'base64');
  const pcm = new Int16Array(Uint8Array.prototype.slice.call(bytes, 0, bytes.length - (bytes.length % 2)).buffer); // a copy: the buffer may start at an odd byte
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 0x8000;
  return samples;
}

// ---- Speaking (advanced/voice/3) ----

const speakers = new Map(); // dataDir -> Promise<OfflineTts>
function speaker(dataDir) {
  if (!speakers.has(dataDir)) {
    const dir = modelDir(dataDir, 'mouth');
    const [model, tokens, espeak] = MODELS.mouth.keep.map((f) => path.join(dir, f));
    const made = loadEngine().OfflineTts.createAsync({ model: { vits: { model, tokens, dataDir: espeak }, numThreads: 2, provider: 'cpu' }, maxNumSentences: 1 });
    made.catch(() => speakers.delete(dataDir));
    speakers.set(dataDir, made);
  }
  return speakers.get(dataDir);
}

// A WAV file (16-bit mono) of the samples.
export function wavOf(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 0x7fff), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// The words spoken: a WAV file. speed 0.7 to 1.4 (1 is the voice's own pace).
export async function speakLocal(dataDir, text, { speed = 1, env = process.env } = {}) {
  const words = String(text ?? '').trim();
  if (!words) throw fail(400, 'Nothing to say.');
  if (faked('mouth', env)) {
    const rate = 16000;
    const seconds = Math.min(3, 0.15 + words.length * 0.004); // short, so a test never waits long
    return wavOf(Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.1 * Math.sin(i / 8)), rate);
  }
  if (!modelReady(dataDir, 'mouth')) throw fail(409, 'The free speaking voice is not here yet.', 'model_missing');
  const tts = await speaker(dataDir);
  const audio = await tts.generateAsync({ text: words, sid: 0, speed: Math.max(0.7, Math.min(1.4, Number(speed) || 1)) });
  return wavOf(audio.samples, audio.sampleRate);
}

// Load both models now, so the first turn of a call does not wait for them (advanced/voice/5).
export async function warmLocal(dataDir, env = process.env) {
  const jobs = [];
  if (!faked('ears', env) && modelReady(dataDir, 'ears')) jobs.push(recognizer(dataDir));
  if (!faked('mouth', env) && modelReady(dataDir, 'mouth')) jobs.push(speaker(dataDir));
  await Promise.all(jobs);
}
