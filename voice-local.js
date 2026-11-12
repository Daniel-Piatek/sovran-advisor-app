// The free voice model (Dictation without an ElevenLabs key): Whisper "base English", the same model the owner
// uses on their own computer, run inside this app by sherpa-onnx (an optional package, only the piece for this
// computer's system is installed). The voice never leaves the computer and it costs nothing.
//
// The model is not part of the download: the first time Dictation needs it, it is fetched once (about 200 MB,
// from the sherpa-onnx releases on GitHub), unpacked with the system's own `tar` (Mac and Windows 10+ have it),
// and kept in data/voice-model/. Only the small ("int8") pieces are kept, about 160 MB.
//
// It hears a piece of up to 30 seconds at a time: the page sends longer dictations in pieces.
// For the tests, VOICE_FAKE_TRANSCRIPT stands in for the model (no download, no engine): it "hears" that text.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL = 'sherpa-onnx-whisper-base.en';
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2`;
const FILES = { encoder: 'base.en-encoder.int8.onnx', decoder: 'base.en-decoder.int8.onnx', tokens: 'base.en-tokens.txt' };
export const SAMPLE_RATE = 16_000;
export const MAX_PIECE_SECONDS = 30;

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const modelDir = (dataDir) => path.join(dataDir, 'voice-model', MODEL);
const fake = (env) => (env.VOICE_FAKE_TRANSCRIPT === undefined ? null : String(env.VOICE_FAKE_TRANSCRIPT));

// ---- The engine (the optional package) ----

let engine; // undefined: not looked for yet · null: not installed on this computer
function loadEngine() {
  if (engine !== undefined) return engine;
  try { engine = createRequire(import.meta.url)('sherpa-onnx-node'); } catch { engine = null; }
  return engine;
}

// ---- The model on disk, and getting it ----

const getting = new Map(); // dataDir -> { received, total, promise, error }

export const modelReady = (dataDir) => Object.values(FILES).every((f) => fs.existsSync(path.join(modelDir(dataDir), f)));

// { state: ready | getting | missing | failed | unavailable, percent?, message? }
export function localStatus(dataDir, env = process.env) {
  if (fake(env) !== null) return { state: 'ready' };
  if (!loadEngine()) return { state: 'unavailable', message: 'The free voice model can’t run on this computer: its engine (sherpa-onnx) is not installed. Ask Claude to “update Sovran Advisor”, or use an ElevenLabs key.' };
  if (modelReady(dataDir)) return { state: 'ready' };
  const job = getting.get(dataDir);
  if (job && !job.error) return { state: 'getting', percent: job.total ? Math.floor((job.received / job.total) * 100) : 0 };
  if (job?.error) return { state: 'failed', message: job.error };
  return { state: 'missing' };
}

function untar(archive, into, members) {
  return new Promise((resolve, reject) => {
    // bsdtar (Mac, Windows) and GNU tar both read .tar.bz2 with -j, and take the members to keep.
    const child = spawn('tar', ['-xjf', archive, '-C', into, ...members.map((m) => `${MODEL}/${m}`)], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar stopped (${code}): ${err.slice(-200)}`))));
  });
}

// Starts getting the model once (later calls join the same download). Resolves when it is ready.
export function prepareLocal(dataDir, { env = process.env, fetcher = fetch } = {}) {
  if (fake(env) !== null || modelReady(dataDir)) return Promise.resolve();
  if (!loadEngine()) return Promise.reject(fail(409, localStatus(dataDir, env).message, 'no_engine'));
  const running = getting.get(dataDir);
  if (running && !running.error) return running.promise;
  const job = { received: 0, total: 0, error: null };
  job.promise = (async () => {
    const root = path.join(dataDir, 'voice-model');
    const part = path.join(root, `${MODEL}.tar.bz2.part`);
    const unpack = path.join(root, `${MODEL}.unpacking`);
    fs.mkdirSync(root, { recursive: true });
    fs.rmSync(unpack, { recursive: true, force: true });
    let res;
    try { res = await fetcher(env.VOICE_MODEL_URL || MODEL_URL, { redirect: 'follow' }); } catch { throw new Error('The voice model could not be downloaded. Is this computer online?'); }
    if (!res.ok || !res.body) throw new Error(`The voice model could not be downloaded (${res.status}).`);
    job.total = Number(res.headers.get('content-length')) || 0;
    const counted = Readable.fromWeb(res.body);
    counted.on('data', (chunk) => { job.received += chunk.length; });
    await pipeline(counted, fs.createWriteStream(part));
    fs.mkdirSync(unpack, { recursive: true });
    try { await untar(part, unpack, Object.values(FILES)); } catch (err) { throw new Error(`The voice model could not be unpacked. ${err.message}`); }
    fs.rmSync(modelDir(dataDir), { recursive: true, force: true });
    fs.renameSync(path.join(unpack, MODEL), modelDir(dataDir));
    fs.rmSync(unpack, { recursive: true, force: true });
    fs.rmSync(part, { force: true });
  })().then(() => { getting.delete(dataDir); }, (err) => {
    job.error = err.message;
    fs.rmSync(path.join(dataDir, 'voice-model', `${MODEL}.tar.bz2.part`), { force: true });
    throw fail(502, err.message, 'model_failed');
  });
  job.promise.catch(() => {}); // the status says what went wrong
  getting.set(dataDir, job);
  return job.promise;
}

// ---- Hearing ----

const recognizers = new Map(); // dataDir -> Promise<OfflineRecognizer>
function recognizer(dataDir) {
  if (!recognizers.has(dataDir)) {
    const dir = modelDir(dataDir);
    const made = loadEngine().OfflineRecognizer.createAsync({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: { whisper: { encoder: path.join(dir, FILES.encoder), decoder: path.join(dir, FILES.decoder) }, tokens: path.join(dir, FILES.tokens), numThreads: 4, provider: 'cpu' },
    });
    made.catch(() => recognizers.delete(dataDir));
    recognizers.set(dataDir, made);
  }
  return recognizers.get(dataDir);
}

// Whisper writes these for silence or noise; they are not words.
const NOT_WORDS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;
export const cleanText = (text) => String(text ?? '').replace(NOT_WORDS, ' ').replace(/\s+/g, ' ').trim();

// samples: 16 kHz mono, -1..1, at most 30 seconds. The words, or '' for silence.
export async function hearPiece(dataDir, samples, { env = process.env } = {}) {
  if (samples.length > SAMPLE_RATE * MAX_PIECE_SECONDS) throw fail(400, `A piece is at most ${MAX_PIECE_SECONDS} seconds.`);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const loud = Math.sqrt(sum / Math.max(1, samples.length));
  if (samples.length < SAMPLE_RATE * 0.2 || loud < 0.003) return ''; // too short, or silence: Whisper would make words up
  if (fake(env) !== null) return cleanText(fake(env));
  if (!modelReady(dataDir)) throw fail(409, 'The free voice model is not here yet.', 'model_missing');
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
