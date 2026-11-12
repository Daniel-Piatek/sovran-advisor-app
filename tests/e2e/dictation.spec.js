// Dictation (advanced/voice/1): hold a key in a field and speak; the words land at the cursor. The
// microphone is made up (a fake device) and the speech service is stood in for by the page's
// WebSocket, so no test uses a real service or a real key.
import { test, expect } from './fixtures.js';

// A phone has no key to hold: its pill says Tap to dictate (the phone project is a touch screen).
const touch = () => test.info().project.name === 'phone';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

// What the stand-in "hears": a partial on the first sound, the final words when the key is let go.
async function standIn(page, { final = 'hello world', error = null } = {}) {
  const seen = { url: null, chunks: 0, commits: 0, sampleRate: null };
  await page.routeWebSocket(/\/v1\/speech-to-text\/realtime/, (ws) => {
    seen.url = ws.url();
    ws.send(JSON.stringify({ message_type: 'session_started', session_id: 's1', config: {} }));
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      seen.chunks++;
      seen.sampleRate = message.sample_rate;
      if (error) { ws.send(JSON.stringify({ message_type: 'quota_exceeded', error })); return; }
      // Silence (an empty final) has no partial either: a first chunk that comes late must not turn it into words.
      if (seen.chunks === 1 && final) ws.send(JSON.stringify({ message_type: 'partial_transcript', text: 'hello wor' }));
      if (message.commit) { seen.commits++; ws.send(JSON.stringify({ message_type: 'committed_transcript', text: final })); }
    });
  });
  return seen;
}
const hold = async (page, ms = 700) => { await page.keyboard.down('AltRight'); await page.waitForTimeout(ms); };
const pill = (page) => page.locator('.mic-pill-live');

test('hold Right Option in a note, speak, let go: the words land at the cursor, the pill says where, and the history has them', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Onboarding call with Lena', body: 'Met Lena in the morning.' });
  const seen = await standIn(page);
  await page.goto(`${app.url}/notes/${note.id}`);
  const text = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(page.getByRole('button', { name: /^Dictate/ })).toContainText(touch() ? 'Tap to dictate' : 'Hold Right ⌥ to dictate');
  await text.click();
  await page.keyboard.press('Control+End');
  await hold(page);
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveAttribute('data-state', 'listening');
  await expect(pill(page)).toContainText('hello wor'); // the words as they come
  await page.keyboard.up('AltRight');
  await expect(text).toContainText('Met Lena in the morning. hello world');
  await expect(pill(page)).toContainText('Wrote 2 words in Text · Onboarding call with Lena');
  expect(seen.commits).toBe(1);
  expect(seen.sampleRate).toBe(16000);
  const url = new URL(seen.url);
  expect([url.pathname, url.searchParams.get('model_id'), url.searchParams.get('audio_format'), url.searchParams.get('commit_strategy'), url.searchParams.get('token')])
    .toEqual(['/v1/speech-to-text/realtime', 'scribe_v2_realtime', 'pcm_16000', 'manual', 'sutkn_test']);
  expect(app.eleven.asked.at(-1)).toEqual({ url: '/v1/single-use-token/realtime_scribe', key: 'test-key' });
  // The note saves it like typing; the history keeps it.
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const [kept] = await send(app, 'GET', '/api/dictations');
  expect([kept.text, kept.outcome, kept.went_to]).toEqual(['hello world', 'inserted', 'Text · Onboarding call with Lena']);
  expect((await send(app, 'GET', `/api/notes/${note.id}`)).body).toContain('Met Lena in the morning. hello world');
  await expect(pill(page)).toBeHidden({ timeout: 8000 }); // and the pill goes back to saying which key to hold
});

test('it works in a plain field too, at the cursor in the middle of a word list', async ({ page, app }) => {
  await standIn(page, { final: 'the dentist' });
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q'); // the quick-add box
  const bar = page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' });
  await bar.fill('call  tomorrow');
  await bar.evaluate((input) => input.setSelectionRange(5, 5));
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(bar).toHaveValue('call the dentist tomorrow');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add a task' })).toBeHidden();
  expect((await send(app, 'GET', '/api/tasks')).map((t) => t.text)).toEqual(['call the dentist']);
});

test('with no field in focus the words are copied to the clipboard and the history marks them Clipboard only; Settings lists and searches it', async ({ page, app }) => {
  await standIn(page, { final: 'remember the workshop in November' });
  await page.goto(`${app.url}/journal`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(pill(page)).toContainText('No field had the focus: 5 words copied to the clipboard');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('remember the workshop in November');
  await page.goto(`${app.url}/settings`);
  const section = page.getByRole('region', { name: 'Dictation' });
  await expect(section.locator('.dictation-row')).toHaveCount(1);
  await expect(section.locator('.dictation-row')).toContainText('remember the workshop in November · Clipboard only');
  await section.getByLabel('Search your dictations').fill('workshop');
  await expect(section.locator('.dictation-row')).toHaveCount(1);
  await section.getByLabel('Search your dictations').fill('zebra');
  await expect(section.getByText('No dictation has those words.')).toBeVisible();
  await section.getByLabel('Search your dictations').fill('');
  await section.getByRole('button', { name: /^Copy/ }).click();
  await expect(section.getByRole('button', { name: /^Copy/ })).toHaveText('Copied');
});

test('the mic in the pill listens hands-free until Done; a tap on the key, or the key with a letter, is not a dictation', async ({ page, app }) => {
  const seen = await standIn(page, { final: 'hands free words' });
  await page.goto(`${app.url}/tasks`);
  const bar = page.getByLabel('Search tasks'); // a plain field (Escape in the quick-add box would close the box)
  await bar.click();
  await page.getByRole('button', { name: /^Dictate/ }).click(); // the pill does not take the focus
  await expect(pill(page)).toHaveAttribute('data-state', 'listening');
  await expect(pill(page)).toContainText('hello wor');
  await pill(page).getByRole('button', { name: 'Done' }).click();
  await expect(bar).toHaveValue('hands free words');
  await expect(pill(page)).toContainText('Wrote 3 words in Search tasks · Tasks');
  const before = seen.commits;
  await bar.fill('');
  await page.keyboard.down('AltRight'); await page.waitForTimeout(60); await page.keyboard.up('AltRight'); // a tap
  await page.keyboard.down('AltRight'); await page.waitForTimeout(40); await page.keyboard.press('a'); await page.waitForTimeout(400); await page.keyboard.up('AltRight'); // Option and a letter
  await page.waitForTimeout(300);
  expect(seen.commits).toBe(before);
  await expect(bar).not.toHaveValue(/hands free/);
  expect((await send(app, 'GET', '/api/dictations')).length).toBe(1);
});

test('Escape while listening throws the dictation away; silence says it heard nothing and keeps nothing', async ({ page, app }) => {
  await standIn(page, { final: '' });
  await page.goto(`${app.url}/tasks`);
  const bar = page.getByLabel('Search tasks'); // a plain field (Escape in the quick-add box would close the box)
  await bar.click();
  await hold(page);
  await page.keyboard.press('Escape');
  await page.keyboard.up('AltRight');
  await expect(pill(page)).toBeHidden();
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(pill(page)).toContainText('Heard nothing.');
  await expect(bar).toHaveValue('');
  expect(await send(app, 'GET', '/api/dictations')).toEqual([]);
});

test('no key yet says where to put it; a service that refuses says so; nothing is kept', async ({ page, app }) => {
  await standIn(page, { error: 'You have used up your quota' });
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q'); // the quick-add box
  await page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' }).click();
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(pill(page)).toContainText('ElevenLabs: You have used up your quota');
  expect(await send(app, 'GET', '/api/dictations')).toEqual([]);
});

test.describe('without a key, with the free voice model', () => {
  test.use({ elevenKey: '', voiceHears: 'see you at North light' });
  test('the model on this computer hears it: the words land when you let go, the glossary fixes them, the history keeps them, and ElevenLabs is never asked', async ({ page, app }) => {
    await send(app, 'POST', '/api/glossary', { term: 'Nordlicht', heard_as: 'North light' });
    const note = await app.createNote({ title: 'Onboarding call with Lena', body: 'Met Lena.' });
    let pieces = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/dictation/local')) pieces++; });
    await page.goto(`${app.url}/notes/${note.id}`);
    const text = page.getByRole('textbox', { name: 'Text', exact: true });
    await text.click();
    await page.keyboard.press('Control+End');
    await hold(page, 1200);
    await expect(pill(page)).toHaveAttribute('data-state', 'listening');
    await page.keyboard.up('AltRight');
    await expect(text).toContainText('Met Lena. see you at Nordlicht');
    await expect(pill(page)).toContainText('your glossary fixed 1');
    expect(pieces).toBe(1);
    const [kept] = await send(app, 'GET', '/api/dictations');
    expect([kept.text, kept.outcome]).toEqual(['see you at Nordlicht', 'inserted']);
    expect(app.eleven.asked).toEqual([]);
    await page.goto(`${app.url}/settings`);
    const section = page.getByRole('region', { name: 'Dictation' });
    await expect(section).toContainText('Free voice model: ready. Your voice is turned into words on this computer and never leaves it.');
    await expect(section).toContainText('Optional: an ElevenLabs key');
    await expect(section.getByRole('button', { name: 'Get it now' })).toBeHidden();
  });

  test('the mic in the pill listens hands-free until Done', async ({ page, app }) => {
    await page.goto(`${app.url}/journal`);
    await page.getByRole('button', { name: /^Dictate/ }).click();
    await expect(pill(page)).toContainText('Listening…');
    await page.waitForTimeout(800);
    await pill(page).getByRole('button', { name: 'Done' }).click();
    await expect(pill(page)).toContainText(/copied to the clipboard|Wrote 5 words/);
    expect((await send(app, 'GET', '/api/dictations')).map((d) => d.text)).toEqual(['see you at North light']);
  });
});

test.describe('without a key, before the free voice model is here', () => {
  test.use({ elevenKey: '', expectedConsoleErrors: [/status of 409/] }); // the session is refused, on purpose
  test('the pill says the model is being fetched (or why not), Settings offers to try again, and the key is never shown', async ({ page, app }) => {
    await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q'); // the quick-add box
    await page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' }).click();
    await hold(page);
    await expect(pill(page)).toContainText(/free voice model|voice model could not be downloaded/);
    await page.keyboard.up('AltRight');
    await page.goto(`${app.url}/settings`);
    await expect(page.getByRole('region', { name: 'Dictation' })).toContainText('Free voice model: The free voice model could not be downloaded (404).');
    await expect(page.getByRole('region', { name: 'Dictation' }).getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dictation' })).toContainText('Optional: an ElevenLabs key');
    // Pasting it once into Settings keeps it; it is never shown again.
    const section = page.getByRole('region', { name: 'Dictation' });
    const field = section.getByLabel('ElevenLabs key');
    await expect(field).toHaveAttribute('type', 'text'); // not a password field: a password manager would offer to save it as a login
    await expect(field).toHaveAttribute('data-lpignore', 'true');
    expect(await field.evaluate((input) => getComputedStyle(input).webkitTextSecurity)).toBe('disc'); // but shown as dots
    await section.getByLabel('ElevenLabs key').fill('sk_pasted_test_key');
    await section.getByRole('button', { name: 'Save key' }).click();
    await expect(section).toContainText('ElevenLabs is connected and used instead of the free model');
    await expect(section.getByLabel('ElevenLabs key')).toHaveValue('');
    expect(await page.content()).not.toContain('sk_pasted_test_key');
    await expect(section.getByRole('button', { name: 'Remove key' })).toBeVisible();
    await section.getByRole('button', { name: 'Remove key' }).click();
    await expect(section).toContainText('Optional: an ElevenLabs key');
  });
});

test('the hold key is a setting; with Dictation switched off there is no pill, no key and no Settings part', async ({ page, app }) => {
  const seen = await standIn(page);
  await page.goto(`${app.url}/settings`);
  const section = page.getByRole('region', { name: 'Dictation' });
  await expect(section.getByRole('group', { name: 'Hold key' }).getByRole('button')).toHaveText(['Right Option (⌥)', 'Right Command (⌘)', 'Right Control (^)']);
  await section.getByRole('button', { name: 'Right Control (^)' }).click();
  await expect(page.getByRole('button', { name: /^Dictate/ })).toContainText(touch() ? 'Tap to dictate' : 'Hold Right ^ to dictate');
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q'); // the quick-add box
  const bar = page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' });
  await bar.click();
  await hold(page, 400);
  await page.keyboard.up('AltRight');
  expect(seen.url).toBeNull(); // Right Option no longer does it
  await page.keyboard.down('ControlRight'); await page.waitForTimeout(500); await page.keyboard.up('ControlRight');
  await expect(bar).toHaveValue('hello world');

  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="voice"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.getByRole('region', { name: 'Dictation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Dictate/ })).toBeHidden();
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q'); // the quick-add box
  await page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' }).click();
  seen.url = null;
  await page.keyboard.down('ControlRight'); await page.waitForTimeout(500); await page.keyboard.up('ControlRight');
  expect(seen.url).toBeNull();
  expect((await send(app, 'GET', '/api/dictations')).length).toBe(1); // the history is kept
});

// ---- The glossary (advanced/voice/2) ----

test('the glossary fixes what is heard, hands People’s names to the speech service, and the pill says it fixed', async ({ page, app }) => {
  await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await send(app, 'POST', '/api/glossary', { term: 'Nordlicht', heard_as: 'North light' });
  const seen = await standIn(page, { final: 'met north light and Lena today' });
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q'); // the quick-add box
  const bar = page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' });
  await bar.click();
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(bar).toHaveValue('met Nordlicht and Lena today');
  await expect(pill(page)).toContainText('your glossary fixed 1');
  expect(new URL(seen.url).searchParams.getAll('keyterms')).toEqual(['Nordlicht', 'Lena Fischer']);
  const [kept] = await send(app, 'GET', '/api/dictations');
  expect([kept.text, kept.fixed]).toEqual(['met Nordlicht and Lena today', 1]);
});

test('correct a word you just dictated and the app offers to learn it; Add, and the next dictation spells it right; Undo takes it back', async ({ page, app }) => {
  await standIn(page, { final: 'We met North light today' });
  await page.goto(`${app.url}/tasks`);
  const bar = page.getByLabel('Search tasks'); // a plain field (Escape in the quick-add box would close the box)
  await bar.click();
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(bar).toHaveValue('We met North light today');
  await bar.fill('We met Nordlicht today'); // the correction
  const proposal = page.locator('.glossary-proposal');
  await expect(proposal).toContainText('You wrote “Nordlicht” where it heard “North light”. Add it to the glossary?', { timeout: 8000 });
  await proposal.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added to your glossary: “North light” is written “Nordlicht” from now on.')).toBeVisible();
  expect((await send(app, 'GET', '/api/glossary')).map((g) => [g.term, g.heard_as, g.source])).toEqual([['Nordlicht', 'North light', 'learned']]);

  await bar.fill('');
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(bar).toHaveValue('We met Nordlicht today');
  await expect(pill(page)).toContainText('your glossary fixed 1');

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await send(app, 'GET', '/api/glossary')).toEqual([]);
});

test('Not now learns nothing; a number or a rewritten sentence is never proposed; it works in a note too', async ({ page, app }) => {
  await standIn(page, { final: 'Pay 120 euros' });
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q'); // the quick-add box
  const bar = page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' });
  await bar.click();
  await hold(page);
  await page.keyboard.up('AltRight');
  await bar.fill('Pay 130 euros');
  await page.waitForTimeout(2500);
  await expect(page.locator('.glossary-proposal')).toHaveCount(0);

  const note = await app.createNote({ title: 'Plan', body: '' });
  await page.unroute(/\/v1\/speech-to-text\/realtime/);
  await standIn(page, { final: 'We met North light today' });
  await page.goto(`${app.url}/notes/${note.id}`);
  const text = page.getByRole('textbox', { name: 'Text', exact: true });
  await text.click();
  await hold(page);
  await page.keyboard.up('AltRight');
  await expect(text).toContainText('We met North light today');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('We met Nordlicht today');
  const proposal = page.locator('.glossary-proposal');
  await expect(proposal).toContainText('“Nordlicht” where it heard “North light”', { timeout: 8000 });
  await proposal.getByRole('button', { name: 'Not now' }).click();
  await expect(proposal).toHaveCount(0);
  expect(await send(app, 'GET', '/api/glossary')).toEqual([]);
});

test.describe('the glossary page', () => {
  test.use({ expectedConsoleErrors: [/status of 400/] }); // one step adds a pair that is refused, on purpose
  test('Settings › Glossary: People’s names are hints, add a fix, remove with Undo, search; gone with Dictation off', async ({ page, app }) => {
  await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await send(app, 'POST', '/api/companies', { name: 'Nordlicht' });
  await page.goto(`${app.url}/settings`);
  const section = page.getByRole('region', { name: 'Glossary' });
  await expect(section.locator('.glossary-row')).toHaveCount(2);
  await expect(section.locator('.glossary-row').first()).toContainText('Hint');
  await expect(section).toContainText('From People');
  await expect(section).toContainText('From Companies');
  await section.getByLabel('Heard as').fill('North light');
  await section.getByLabel('Written as').fill('Nordlicht Studio');
  await section.getByRole('button', { name: 'Add' }).click();
  await expect(section.locator('.glossary-row').first()).toContainText('Fix“North light” → Nordlicht StudioYou added it');
  await section.getByLabel('Heard as').fill('Nordlicht Studio');
  await section.getByLabel('Written as').fill('Nordlicht Studio');
  await section.getByRole('button', { name: 'Add' }).click();
  await expect(section.getByRole('alert')).toHaveText('Heard as and written as are the same.');
  await section.getByLabel('Search the glossary').fill('north');
  await expect(section.locator('.glossary-row')).toHaveCount(1); // what it is heard as is searched too
  await section.getByLabel('Search the glossary').fill('lena');
  await expect(section.locator('.glossary-row')).toHaveCount(1);
  await section.getByRole('button', { name: 'Remove Lena Fischer' }).click();
  await expect(section.getByText('Nothing in the glossary matches.')).toBeVisible();
  await section.getByRole('button', { name: 'Undo' }).click();
  await expect(section.locator('.glossary-row')).toHaveCount(1);
  await page.locator('[data-module="voice"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.getByRole('region', { name: 'Glossary' })).toHaveCount(0);
});
});
