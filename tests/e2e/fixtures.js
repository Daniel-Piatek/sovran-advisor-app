// Test fixtures: every test gets its own copy of the app, on a free port,
// with its own empty database in the test's output folder.
// Every test also fails if the page logs an error to the console.

import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeGoogle } from '../fake-google.js';
import { startFakeGmail } from '../fake-gmail.js';
import { startFakeGcal } from '../fake-gcal.js';

const serverFile = fileURLToPath(new URL('../../server.js', import.meta.url));
// The assistant answers with a stand-in for the claude command: no test uses a real AI model.
const fakeClaude = fileURLToPath(new URL('../fake-claude.js', import.meta.url));

export const test = base.extend({
  // The ElevenLabs key of the test copy ('' means there is none): Dictation tests use a stand-in for the
  // token service (no real service, no real key) and the page's WebSocket is stood in for in the test.
  elevenKey: ['test-key', { option: true }],
  // What the free voice model "hears" (null: no stand-in, and the model is not on the computer; it is never really fetched).
  voiceHears: [null, { option: true }],
  app: async ({ elevenKey, voiceHears }, use, testInfo) => {
    const dataDir = testInfo.outputPath('data');
    const eleven = http.createServer((req, res) => {
      if (req.url.startsWith('/voice-model')) { res.writeHead(404); res.end(); return; } // the free voice model's download: not here
      eleven.asked.push({ url: req.url, key: req.headers['xi-api-key'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: 'sutkn_test' }));
    });
    eleven.asked = [];
    // Google is stood in for too (tests/fake-google.js), with a key store of its own in a folder beside the data.
    const google = await startFakeGoogle();
    const keyStoreDir = testInfo.outputPath('key-store');
    const gmail = await startFakeGmail({ email: 'work@mypractice.com' }); // Gmail's own API, stood in for; a test fills its `messages`
    const gcal = await startFakeGcal(); // Google Calendar's own API, stood in for; a test fills its `events`
    await new Promise((resolve) => eleven.listen(0, '127.0.0.1', resolve));
    const child = spawn(process.execPath, [serverFile], {
      env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ELEVENLABS_API_KEY: elevenKey, ELEVENLABS_API_BASE: `http://127.0.0.1:${eleven.address().port}`, VOICE_MODEL_URL: `http://127.0.0.1:${eleven.address().port}/voice-model.tar.bz2`, ...(voiceHears === null ? {} : { VOICE_FAKE_TRANSCRIPT: voiceHears }), ASSISTANT_COMMAND: JSON.stringify([process.execPath, fakeClaude]), CODEX_COMMAND: JSON.stringify([process.execPath, fakeClaude.replace('fake-claude.js', 'fake-codex.js')]), CODEX_HOME: path.join(dataDir, '.codex-home'), FAKE_LINK_TITLES: '1', ...google.env, ...gmail.env, ...gcal.env, GOOGLE_KEY_STORE_DIR: keyStoreDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const url = await new Promise((resolve, reject) => {
      let stdout = '';
      const slow = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`The app did not start within 10 s.\nIt printed:\n${stdout}\n${stderr}`));
      }, 10_000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        const match = stdout.match(/Listening on (http:\/\/\S+)/);
        if (match) { clearTimeout(slow); resolve(match[1]); }
      });
      child.on('exit', (code) => { clearTimeout(slow); reject(new Error(`App exited (${code}) before starting:\n${stderr}`)); });
    });

    // Test data goes in through the app's own API, like the page would send it.
    const send = async (method, apiPath, body) => {
      const res = await fetch(url + apiPath, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${apiPath}: ${res.status}`);
      return res.json();
    };
    // A new install starts with some sections switched off (modules.js, starter: false); the tests start with everything on.
    for (const id of ['tasks', 'planner', 'calendar', 'life', 'voice', 'calendar-google', 'mylife-plus', 'mail']) await send('PATCH', '/api/modules', { id, on: true });
    await send('PATCH', '/api/welcome', { seen: true }); // the welcome has its own test
    const createNote = (note = {}) => send('POST', '/api/notes', note);
    const updateNote = (id, changes) => send('PATCH', `/api/notes/${id}`, changes);

    await use({ url, dataDir, dbFile: path.join(dataDir, 'app.db'), createNote, updateNote, eleven, google, gmail, gcal, keyStoreDir });

    child.kill('SIGTERM');
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
    eleven.close();
    await google.close();
    await gmail.close();
    await gcal.close();
  },

  // A test that makes an error on purpose names it here, for example
  // test.use({ expectedConsoleErrors: [/404/] }). Every other error fails the test.
  expectedConsoleErrors: [[], { option: true }],

  // The page depends on the app, so the page is checked and closed before the app stops:
  // a request still under way when a test ends is never cut off by a stopped app.
  page: async ({ page, expectedConsoleErrors, app }, use) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));
    await use(page);
    const unexpected = errors.filter((text) => !expectedConsoleErrors.some((re) => re.test(text)));
    expect(unexpected, 'console errors on the page').toEqual([]);
  },
});

export { expect };

// Puts the cursor at the end of a text the way a person does on any screen: a tap just
// after its last word. (End does that on a computer, but in a phone's browser End scrolls
// a page that is taller than the screen instead of moving the cursor.)
export async function tapAtEnd(editor) {
  const last = editor.locator(':scope > *').last();
  const box = await last.boundingBox();
  await last.click({ position: { x: box.width - 2, y: box.height / 2 } });
  await editor.page().evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
}

// A new journal entry, the way a person starts one: New entry on the day's page (today, or
// the day given), the cursor in its title, and Enter to go on to its text. The entry is made once something is written.
export async function newEntry(page, app, day = null) {
  await page.goto(`${app.url}/journal${day ? `/${day}` : ''}`);
  await page.getByRole('link', { name: 'New entry' }).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
}
