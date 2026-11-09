import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server.js';
import { LIBRARY_URL } from '../../sovran-library.js';

test('the Sovran Library key: kept here, only its end shown, checked, removable; the assistant gets the library with it', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-'));
  // A stand-in claude that prints the --mcp-config file it was given, as its answer.
  const fake = path.join(dataDir, 'fake-claude.mjs');
  fs.writeFileSync(fake, `import fs from 'node:fs';
const config = process.argv[process.argv.indexOf('--mcp-config') + 1];
const allowed = process.argv[process.argv.indexOf('--allowedTools') + 1];
const text = JSON.stringify({ servers: Object.keys(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers), url: JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.library?.url ?? '', allowed });
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', result: text, session_id: 's1' }));
`);
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, assistantCommand: [process.execPath, fake] });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = async (method, url, body) => {
    const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  };
  const json = async (...args) => JSON.parse((await send(...args)).text);
  const ask = async () => {
    const chat = await json('POST', '/api/conversations', {});
    const lines = (await send('POST', `/api/conversations/${chat.id}/messages`, { text: 'Which servers?' })).text;
    const done = (await json('GET', `/api/conversations/${chat.id}`)).messages.at(-1).text;
    return JSON.parse(done || lines);
  };

  assert.deepEqual(await json('GET', '/api/library'), { connected: false, key_end: '' });
  assert.deepEqual((await ask()).servers, ['app']);
  assert.equal((await send('PUT', '/api/library', { key: 'not a key' })).status, 400);
  const key = 'sovran_abcdefghijklmnopqrstuvwxyz0123';
  assert.deepEqual(await json('PUT', '/api/library', { key: `  ${key} ` }), { connected: true, key_end: '0123' });
  assert.equal((await send('GET', '/api/library')).text.includes(key), false); // the whole key never goes back to a page
  const withLibrary = await ask();
  assert.deepEqual(withLibrary.servers, ['app', 'library']);
  assert.equal(withLibrary.url, `${LIBRARY_URL}/${key}`);
  assert.equal(withLibrary.allowed, 'mcp__app,mcp__library');
  assert.deepEqual(await json('PUT', '/api/library', { key: '' }), { connected: false, key_end: '' });
  assert.equal((await send('DELETE', '/api/library')).status, 405);
});
