// Voice calls with your assistant (advanced/voice/3-7). No microphone and no voice model: the page's ears are stood in for
// (window.__sovranCallEar, which a test answers with what you "said"), the speaking voice is a short tone
// (VOICE_FAKE_SPEECH) and the assistant is tests/fake-claude.js. Everything else is the app's own.
import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// The stand-in ears: each turn waits for the test to say something.
async function ears(page) {
  await page.addInitScript(() => {
    window.__sovranCallEar = () => new Promise((resolve) => { window.__hear = resolve; });
  });
}
const widget = (page) => page.getByRole('group', { name: 'Call', exact: true });
async function say(page, words) {
  await expect(widget(page)).toContainText('Listening');
  await page.waitForFunction(() => typeof window.__hear === 'function');
  await page.evaluate((w) => { const hear = window.__hear; window.__hear = null; hear(w); }, words);
}
const callButton = (page) => page.getByRole('button', { name: /^Call your assistant/ });

// Without an ElevenLabs key, as a student has it: the free voice on this computer.
test.describe('without a key', () => {
  test.use({ elevenKey: '', voiceHears: 'unused' }); // the page's ears are stood in; this makes the voice model count as here
  test('Call: a plain question is answered from your data, no model; both turns are in the chat, marked, with the time to the first word', async ({ page, app }) => {
    await send(app, 'POST', '/api/events', { title: 'Call with Lena', starts_at: `${today()}T23:30`, ends_at: `${today()}T23:45` });
    await ears(page);
    await page.goto(`${app.url}/assistant`);
    await expect(callButton(page)).toHaveAccessibleName(/ready/); // warmed (the stand-ins are always ready)
    await callButton(page).click();
    await expect(widget(page)).toContainText('Listening');
    await expect(widget(page)).toContainText('You');
    await say(page, 'What is on today?');
    const chat = page.getByRole('log', { name: 'Conversation' });
    await expect(chat).toContainText('23:30–23:45 Call with Lena');
    await expect(chat.locator('[data-role="user"]')).toContainText('Said on a call');
    await expect(chat.locator('[data-role="assistant"]')).toContainText('from your data, no model');
    await expect(chat.locator('[data-role="assistant"]')).toContainText(/first word \d+\.\d s/);
    await expect(widget(page)).toContainText('Listening'); // and it is your turn again
    await page.getByRole('button', { name: 'End call' }).first().click();
    await expect(widget(page)).toBeHidden();
    // Settings › Voice has the numbers.
    await page.goto(`${app.url}/settings`);
    const voice = page.getByRole('region', { name: 'Voice', exact: true });
    await expect(voice).toContainText('Median of your last 1 call');
    await expect(voice).toContainText('Alba (British English), on this computer');
    await voice.getByRole('button', { name: 'Faster' }).click();
    await expect(voice.getByRole('button', { name: 'Faster' })).toHaveAttribute('aria-pressed', 'true');
    expect((await send(app, 'GET', '/api/call/settings')).speed).toBe(1.15);
  });
});

test('a question for your assistant goes to the chat as a normal message; a slow answer gets one short true line first', async ({ page, app }) => {
  await ears(page);
  await page.goto(`${app.url}/assistant`);
  await callButton(page).click();
  await say(page, 'slow: tell me about my notes');
  await expect(widget(page)).toContainText('Speaking');
  const chat = page.getByRole('log', { name: 'Conversation' });
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText('your assistant', { timeout: 20000 });
  await expect(chat).toContainText('Said while it thought: “Let me look at your notes.”');
  await expect(chat.locator('[data-role="user"]')).toContainText('Said on a call');
});

test('a request to do something: Working on it, then Done; what asks first is read out and a spoken yes approves the card', async ({ page, app }) => {
  await ears(page);
  await page.goto(`${app.url}/assistant`);
  await callButton(page).click();
  // Add a task asks first (the default): the call reads the card out.
  await say(page, 'add a task: call the venue');
  await expect(widget(page)).toContainText('Asks first: Add a task: “call the venue”', { timeout: 15000 });
  await say(page, 'yes');
  await expect(widget(page)).toContainText('Done: Added a task: “call the venue”');
  expect((await send(app, 'GET', '/api/tasks')).map((t) => t.text)).toContain('call the venue');
  await expect(page.getByRole('group', { name: /call the venue/ }).first()).toContainText('Approved');
  // Allowed alone, it is done at once and the call says so.
  await send(app, 'PUT', '/api/assistant/permissions', { key: 'add_task', mode: 'alone' });
  await say(page, 'add a task: book the hall');
  await expect(widget(page)).toContainText('Done: Added a task: “book the hall”', { timeout: 15000 });
});

test('Settings › Voice log › Try it: the voice stops, the call offers to go on in writing, the chat says so, and the log has it', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  const log = page.getByRole('region', { name: 'Voice log' });
  await expect(log).toContainText('Nothing has failed on a call.');
  await log.getByRole('link', { name: 'Try it: a call where the voice service stops' }).click();
  await expect(widget(page)).toContainText('The voice service is not answering. Go on in writing?');
  await widget(page).getByRole('button', { name: 'Go on in writing' }).click();
  await expect(widget(page)).toBeHidden();
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('The call went on in writing.');
  await page.goto(`${app.url}/settings`);
  await expect(page.getByRole('region', { name: 'Voice log' })).toContainText('Voice service · The voice service is not answering. (tried on purpose)');
});

test('with Dictation switched off there is no Call button and no Voice settings', async ({ page, app }) => {
  await send(app, 'PATCH', '/api/modules', { id: 'voice', on: false });
  await page.goto(`${app.url}/assistant`);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(callButton(page)).toBeHidden();
  expect((await fetch(`${app.url}/api/call/stats`)).status).toBe(409);
  await page.goto(`${app.url}/settings`);
  await expect(page.getByRole('region', { name: 'Voice log' })).toHaveCount(0);
});
