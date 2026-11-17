// Keep this chat saved: a chat the student's AI saved through the Sovran Library shows in the Inbox as one item,
// marked "From your chat with Claude", and new parts join it. The app runs here with a stand-in drop box
// (tests/fake-drop-box.js); the save tool is the real one (cloud/library-save/save.js).

import { test, expect } from '@playwright/test';
import { startServer } from '../../server.js';
import { saveToAdvisor } from '../../cloud/library-save/save.js';
import { fakeBox } from '../fake-drop-box.js';
import { useReports } from '../../reports.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';
// On a phone the list comes first and an item is opened by tapping it (as in inbox.spec.js).
async function showFirst(page) {
  const words = page.getByRole('textbox', { name: 'Capture text' });
  await expect(page.locator('.inbox-item:visible, [aria-label="Capture text"]:visible').first()).toBeVisible();
  if (page.viewportSize().width <= 600 && !(await words.isVisible())) await page.locator('.inbox-item').first().click();
  await expect(words).toBeVisible();
}

test('a saved chat is one Inbox item, marked as from your chat with Claude, and grows', async ({ page }, testInfo) => {
  const box = fakeBox();
  box.students.set(box.sha(KEY), 'client-madeup');
  const app = await startServer({ dataDir: testInfo.outputPath('data'), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0, phoneDropFetch: box.fetcher });
  useReports({ fetch: async () => new Response('{}', { status: 401 }) }); // the copies for the phone's shelf never ask the real library from a test
  try {
    const api = (method, p, body) => fetch(app.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const save = (args) => saveToAdvisor(box.libraryTx('client-madeup'), { id: 'client-madeup' }, args);
    await api('PUT', '/api/library', { key: KEY });
    await api('PATCH', '/api/modules', { id: 'phone-drop', on: true });
    await api('POST', '/api/phone-drop/link', {});
    await api('POST', '/api/phone-drop/check', {});
    const first = await save({ title: 'My Pattern and my work', assistant: 'Claude', turns: [
      { number: 1, asked: 'What does my Pattern say about how I work?', answer: 'Your report speaks of **steady building**: you make things that last.' },
      { number: 2, asked: 'And when I am tired?', answer: 'It names rest as part of the work, not a break from it.' }] });
    await api('POST', '/api/phone-drop/check', {});

    await page.goto(`${app.url}/inbox`);
    await showFirst(page);
    const line = page.locator('.inbox-chat');
    await expect(line).toContainText('From your chat with Claude');
    await expect(line).toContainText('2 questions');
    await expect(page.locator('.inbox-words')).toContainText('My Pattern and my work');
    await expect(page.locator('.inbox-words')).toContainText('You asked: What does my Pattern say about how I work?');
    await expect(page.locator('.inbox-words strong', { hasText: 'steady building' })).toBeVisible();

    await save({ chat_id: /chat_id: ([a-z0-9]{12})/.exec(first.text)[1], turns: [{ number: 3, asked: 'What is one small step?', answer: 'Choose one thing to finish this week.' }] });
    await api('POST', '/api/phone-drop/check', {});
    await page.reload();
    await showFirst(page);
    await expect(page.locator('.inbox-chat')).toContainText('3 questions');
    await expect(page.locator('.inbox-words')).toContainText('Choose one thing to finish this week.');
    if (testInfo.project.name === 'desktop') await page.screenshot({ path: testInfo.outputPath('saved-chat.png') });

    // Settings says saving chats is ready.
    await page.goto(`${app.url}/settings`);
    await expect(page.getByText('Chats with your AI: ready.')).toBeAttached();
  } finally { await app.close(); }
});
