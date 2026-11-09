// The assistant with your notes (assistant/2), answered by the stand-in claude command
// (tests/fake-claude.js) through the app's real tools: no test depends on a real AI model.
import { test, expect } from './fixtures.js';

const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);
async function ask(page, text) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
  return bubbles(page, 'assistant').last();
}

test('what did I write about the bank? It finds and quotes the note, cited; the citation opens it', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Bank call', body: 'They will send the new rate by Friday.' });
  await page.goto(`${app.url}/assistant`);
  const answer = await ask(page, 'What did I write about the bank?');
  await expect(answer.locator('.chat-text')).toHaveText('You wrote in Bank call: “They will send the new rate by Friday.”');
  await expect(answer.getByRole('link', { name: 'Bank call' }).first()).toHaveAttribute('href', `/notes/${note.id}`);
  await answer.locator('.chat-steps summary').click();
  await expect(answer.locator('.chat-step')).toHaveText(['Searched your notes forbank', 'ReadBank call']);
  await answer.locator('.citation').click();
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);
  await expect(page.locator('.note-info')).toBeVisible();
});

test('add a task you asked for (set to Does it alone): it goes straight in, shows in Tasks, and Undo on its card takes it back', async ({ page, app }) => {
  await fetch(`${app.url}/api/assistant/permissions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'add_task', mode: 'alone' }) });
  await page.goto(`${app.url}/assistant`);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const answer = await ask(page, `Add a task: call the venue on ${day}`);
  const card = answer.locator('.action-card');
  await expect(card).toHaveAttribute('data-state', 'done');
  await expect(card).toContainText('Added a task: “call the venue” · Tomorrow');
  const chat = page.url();
  await page.goto(`${app.url}/tasks`);
  await page.getByRole('tab', { name: /Upcoming/ }).click();
  await expect(page.locator('.task-row', { hasText: 'call the venue' })).toBeVisible();
  await page.goto(chat);
  await bubbles(page, 'assistant').last().locator('.action-card').getByRole('button', { name: 'Undo' }).click();
  await expect(bubbles(page, 'assistant').last().locator('.action-card')).toHaveAttribute('data-state', 'undone');
  await page.goto(`${app.url}/tasks`);
  await page.getByRole('tab', { name: /Upcoming/ }).click();
  await expect(page.locator('.task-row', { hasText: 'call the venue' })).toHaveCount(0);
});

test('ask it to tidy a note: a card with Apply and Dismiss; Apply changes it, Undo puts it back', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Garden ideas', body: 'plant  tulips\nfix the   fence' });
  await page.goto(`${app.url}/assistant`);
  const answer = await ask(page, 'Please tidy the note garden ideas');
  const card = answer.locator('.action-card');
  await expect(card).toHaveAttribute('data-state', 'proposed');
  await expect(card).toContainText('A change to “Garden ideas”: Tidied the spacing and capitalsWaiting for you');
  await expect(card.locator('.action-preview-text')).toHaveText('Plant tulips\n\nFix the fence');
  expect((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body).toBe('plant  tulips\nfix the   fence');
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card).toHaveAttribute('data-state', 'applied');
  expect((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body).toBe('Plant tulips\n\nFix the fence');
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toHaveAttribute('data-state', 'undone');
  expect((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body).toBe('plant  tulips\nfix the   fence');
});

test('ticking a task it was not asked to tick waits on a card; Dismiss leaves it open', async ({ page, app }) => {
  await fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Pay rent' }) });
  await page.goto(`${app.url}/assistant`);
  const card = (await ask(page, 'Please tick the task pay rent')).locator('.action-card');
  await expect(card).toContainText('Tick “Pay rent”');
  await card.getByRole('button', { name: 'Dismiss' }).click();
  await expect(card).toHaveAttribute('data-state', 'dismissed');
  expect((await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Pay rent').done).toBe(false);
});

test('Ask your notes on a journal entry: the question carries the page, and the answer links back to it', async ({ page, app }) => {
  const entry = await (await fetch(`${app.url}/api/entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Planning', body: 'We go with the smaller venue.\nBook it next week.' }),
  })).json();
  await page.goto(`${app.url}/journal/entries/${entry.id}`);
  await expect(page.locator('.note-info')).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Ask your notes' });
  await box.fill('What did I decide here?');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]{36}$/);
  await expect(bubbles(page, 'user')).toContainText('What did I decide here?');
  await expect(bubbles(page, 'user').locator('.chat-context')).toHaveAttribute('href', `/journal/entries/${entry.id}`);
  const answer = bubbles(page, 'assistant');
  await expect(answer).toHaveAttribute('data-state', 'done');
  await expect(answer.locator('.chat-text')).toContainText('Here you decided: “We go with the smaller venue.”');
  await expect(answer.locator('.citation')).toHaveAttribute('href', `/journal/entries/${entry.id}`);
  await expect(page.getByRole('textbox', { name: 'Ask your notes' })).toBeHidden(); // not on the Assistant itself
});
