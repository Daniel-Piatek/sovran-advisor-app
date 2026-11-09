// Planning and closing the day with your assistant (the assistant steps of time/3 and
// time/4), with the stand-in claude command: no test depends on a real AI model.
import { test, expect } from './fixtures.js';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const post = (app, url, body) => fetch(`${app.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const tasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());
const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);
async function say(page, text) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
}

test('plan my week with me: a card with its reason on the board; Apply moves the task, Undo puts it back', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/tasks', { text: 'Write the offer', due: today, estimate: 400 });
  await post(app, '/api/tasks', { text: 'Sort the attic', due: today, estimate: 120 });
  await page.goto(`${app.url}/assistant`);
  await say(page, 'Plan my week with me');
  await expect(bubbles(page, 'assistant').last().locator('.chat-text')).toContainText('holds too much, over by 40 minutes');
  await page.goto(`${app.url}/planner?view=week`);
  const board = page.getByRole('region', { name: 'Your assistant suggests' });
  const card = board.locator('.action-card');
  await expect(card).toContainText('Move “Sort the attic” to');
  await expect(card).toContainText('over budget by 40 min');
  expect((await tasks(app)).find((t) => t.text === 'Sort the attic').due).toBe(today);
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card).toHaveAttribute('data-state', 'applied');
  expect((await tasks(app)).find((t) => t.text === 'Sort the attic').due).not.toBe(today);
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(board).toBeHidden();
  expect((await tasks(app)).find((t) => t.text === 'Sort the attic').due).toBe(today);
});

test('let’s shut down the day: your assistant suggests a line, and nothing is saved until you say yes', async ({ page, app }) => {
  const today = localDay();
  const offer = await post(app, '/api/tasks', { text: 'Write the offer', due: today });
  await fetch(`${app.url}/api/tasks/${offer.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) });
  await fetch(`${app.url}/api/highlights/${today}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: offer.id }) });
  await page.goto(`${app.url}/assistant`);
  await say(page, 'Let’s shut down the day');
  const card = bubbles(page, 'assistant').last().locator('.action-card');
  await expect(card).toContainText('Close Today with the line “Did 1 of 1, Highlight done.” · Highlight done');
  expect(await (await fetch(`${app.url}/api/shutdown/${today}`)).json()).toBe(null);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toHaveAttribute('data-state', 'applied');
  await page.goto(`${app.url}/planner`);
  await expect(page.getByRole('region', { name: 'Day closed' })).toContainText('“Did 1 of 1, Highlight done.”');
});
