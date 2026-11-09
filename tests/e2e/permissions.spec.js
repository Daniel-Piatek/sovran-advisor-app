// What the assistant may do alone, and what waits for you (assistant/4), with the stand-in
// claude command (tests/fake-claude.js): no test depends on a real AI model.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';

const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);
const tasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
async function say(page, text) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

test('Add a task asks first: a card, and no task until you approve; switched to Does it alone, no card', async ({ page, app }) => {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  await page.goto(`${app.url}/settings`);
  const addTask = page.getByRole('group', { name: 'Add a task' });
  await expect(addTask.getByRole('button', { name: 'Asks first' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Write in your journal' }).getByRole('button', { name: 'Does it alone' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`${app.url}/assistant`);
  await say(page, `Add a task: call the venue on ${localDay(tomorrow)}`);
  const card = bubbles(page, 'assistant').last().locator('.action-card');
  await expect(card).toHaveAttribute('data-state', 'proposed');
  await expect(card).toContainText('Add a task: “call the venue” · Tomorrow');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
  await expect(bubbles(page, 'assistant').last().locator('.chat-text')).toHaveText('It waits for your approval on the card.');
  expect(await tasks(app)).toEqual([]);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toHaveAttribute('data-state', 'applied');
  expect((await tasks(app)).map((t) => [t.text, t.due])).toEqual([['call the venue', localDay(tomorrow)]]);

  await page.goto(`${app.url}/settings`);
  await page.getByRole('group', { name: 'Add a task' }).getByRole('button', { name: 'Does it alone' }).click();
  await expect(page.getByRole('group', { name: 'Add a task' }).getByRole('button', { name: 'Does it alone' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('You switched Add a task: Does it alone');
  await page.goto(`${app.url}/assistant`);
  await say(page, 'Add a task: buy flowers');
  await expect(bubbles(page, 'assistant').last().locator('.action-card')).toHaveAttribute('data-state', 'done');
  expect((await tasks(app)).some((t) => t.text === 'buy flowers')).toBe(true);
});

test('reading a file outside its folder: a card appears, and nothing happens until you answer', async ({ page, app }) => {
  const outside = path.join(app.dataDir, 'outside.txt');
  fs.writeFileSync(outside, 'The plan is ready.\nmore');
  await page.goto(`${app.url}/assistant`);
  await say(page, `Please read the file ${outside}`);
  const answer = bubbles(page, 'assistant').last();
  const card = answer.locator('.action-card');
  await expect(card).toContainText(`Wants to: Read outside its folder: ${outside}`);
  await page.waitForTimeout(500);
  await expect(answer).toHaveAttribute('data-state', 'answering'); // it waits for you
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(answer).toHaveAttribute('data-state', 'done');
  await expect(answer.locator('.chat-text')).toHaveText('It begins: The plan is ready.');
  await expect(card).toContainText('Allowed');

  await say(page, `Please read the file ${outside}`);
  await bubbles(page, 'assistant').last().locator('.action-card').getByRole('button', { name: 'No' }).click();
  await expect(bubbles(page, 'assistant').last().locator('.chat-text')).toHaveText('I wasn’t allowed to read it.');
});

test('Always allow: the second read in that folder needs no card; Settings lists it and Remove brings the card back', async ({ page, app }) => {
  const outside = path.join(app.dataDir, 'outside.txt');
  fs.writeFileSync(outside, 'The plan is ready.\nmore');
  await page.goto(`${app.url}/assistant`);
  await say(page, `Please read the file ${outside}`);
  await bubbles(page, 'assistant').last().locator('.action-card').getByRole('button', { name: 'Always allow' }).click();
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
  await say(page, `Please read the file ${outside}`);
  const second = bubbles(page, 'assistant').last();
  await expect(second).toHaveAttribute('data-state', 'done');
  await expect(second.locator('.action-card')).toHaveCount(0);
  await page.goto(`${app.url}/settings`);
  const list = page.getByRole('region', { name: 'Always allowed' });
  await expect(list).toContainText(`Read files in ${path.dirname(outside)}`);
  await list.getByRole('button', { name: /Remove/ }).click();
  await expect(list).toContainText('Nothing yet.');
  await page.goto(`${app.url}/assistant`);
  await say(page, `Please read the file ${outside}`);
  await expect(bubbles(page, 'assistant').last().locator('.action-card')).toBeVisible();
});

test('the floor: even with work outside its folder allowed, sudo is refused, and it is in the activity log', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  await page.getByRole('group', { name: /Work outside its own folder/ }).getByRole('button', { name: 'Does it alone' }).click();
  await expect(page.getByRole('group', { name: /Work outside its own folder/ }).getByRole('button', { name: 'Does it alone' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('note', { name: 'Always' })).toContainText('Never, whatever is switched on: sudo');
  await page.goto(`${app.url}/assistant`);
  await say(page, 'run ls -la /tmp');
  await expect(bubbles(page, 'assistant').last().locator('.chat-text')).toHaveText('Ran: ls -la /tmp');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
  await say(page, 'run sudo ls /');
  const answer = bubbles(page, 'assistant').last();
  await expect(answer.locator('.chat-text')).toHaveText('I wasn’t allowed to run it.');
  await expect(answer.locator('.action-card')).toHaveAttribute('data-state', 'refused');
  await expect(answer.locator('.action-card')).toContainText('Never allowed');
  await page.goto(`${app.url}/settings`);
  await expect(page.getByRole('list', { name: 'Activity' }).locator('.activity-row').first()).toContainText('Refused Step: Run a command: sudo ls /');
});
