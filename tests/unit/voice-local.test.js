// The free voice model (Dictation with no ElevenLabs key): getting it once, and hearing a piece of sound.
// The real model is never fetched here: a made-up archive with the same names stands in for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { cleanText, samplesOf, hearPiece, localStatus, prepareLocal, modelReady } from '../../voice-local.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

test('Whisper’s marks for silence and noise are not words', () => {
  assert.equal(cleanText(' [BLANK_AUDIO] '), '');
  assert.equal(cleanText('Hello (music) there  *coughs* [inaudible] friend.'), 'Hello there friend.');
});

test('the page’s 16-bit sound becomes samples, whatever byte it starts at', () => {
  const pcm = new Int16Array([0, 16384, -32768, 32767]);
  const samples = samplesOf(Buffer.from(pcm.buffer).toString('base64'));
  assert.deepEqual([...samples].map((v) => Math.round(v * 1000) / 1000), [0, 0.5, -1, 1]);
  assert.throws(() => samplesOf(''), /base64/);
});

test('silence and very short sound are heard as nothing; more than 30 seconds is refused; the stand-in hears its words', async () => {
  const dir = tmp('voice-');
  const env = { VOICE_FAKE_TRANSCRIPT: 'hello there [BLANK_AUDIO]' };
  const tone = (seconds) => Float32Array.from({ length: Math.round(16000 * seconds) }, (_, i) => 0.2 * Math.sin(i / 5));
  assert.equal(await hearPiece(dir, new Float32Array(16000), { env }), '');
  assert.equal(await hearPiece(dir, tone(0.1), { env }), '');
  assert.equal(await hearPiece(dir, tone(1), { env }), 'hello there');
  await assert.rejects(hearPiece(dir, tone(31), { env }), /at most 30 seconds/);
  assert.deepEqual(localStatus(dir, env), { state: 'ready' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the model is fetched once, unpacked, and only its small pieces are kept; a failed download says so and can be tried again', async (t) => {
  // A made-up archive with the model's names (and a big piece that is not kept).
  const src = tmp('voice-src-');
  const inner = path.join(src, 'sherpa-onnx-whisper-base.en');
  fs.mkdirSync(inner);
  for (const f of ['base.en-encoder.int8.onnx', 'base.en-decoder.int8.onnx', 'base.en-tokens.txt', 'base.en-decoder.onnx']) fs.writeFileSync(path.join(inner, f), f);
  const archive = path.join(src, 'model.tar.bz2');
  execFileSync('tar', ['-cjf', archive, '-C', src, 'sherpa-onnx-whisper-base.en']);
  let up = false;
  const server = http.createServer((req, res) => {
    if (!up) { res.writeHead(503); res.end(); return; }
    const body = fs.readFileSync(archive);
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(src, { recursive: true, force: true }); });
  const env = { VOICE_MODEL_URL: `http://127.0.0.1:${server.address().port}/model.tar.bz2` };
  const dir = tmp('voice-data-');
  if (localStatus(dir, env).state === 'unavailable') { t.skip('sherpa-onnx is not installed for this system'); return; }
  assert.equal(localStatus(dir, env).state, 'missing');
  await assert.rejects(prepareLocal(dir, { env }), /could not be downloaded \(503\)/);
  assert.equal(localStatus(dir, env).state, 'failed');
  up = true;
  await prepareLocal(dir, { env });
  assert.equal(modelReady(dir), true);
  assert.equal(localStatus(dir, env).state, 'ready');
  const kept = fs.readdirSync(path.join(dir, 'voice-model', 'sherpa-onnx-whisper-base.en')).sort();
  assert.deepEqual(kept, ['base.en-decoder.int8.onnx', 'base.en-encoder.int8.onnx', 'base.en-tokens.txt']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'voice-model')), ['sherpa-onnx-whisper-base.en']); // no archive left behind
  fs.rmSync(dir, { recursive: true, force: true });
});
