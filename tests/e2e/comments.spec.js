// Comments on a passage (advanced/writing/3). The assistant is tests/fake-claude.js.
import { test, expect, tapAtEnd } from './fixtures.js';

const BODY = '* Three parts\n  * Two quiet mornings\n* Price it as a fixed package\n  * Followed by the schedule';
const text = (page) => page.getByLabel('Text');
const threadsOf = (app, id) => fetch(`${app.url}/api/notes/${id}/comments`).then((r) => r.json());

async function openNote(page, app) {
  const note = await app.createNote({ title: 'Proposal outline for Nordlicht', body: BODY });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(text(page)).toContainText('Price it as a fixed package');
  return note;
}
async function comment(page, passage, words) {
  await text(page).getByText(passage, { exact: true }).click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Comment on the selected words' }).click();
  await page.getByLabel('Your comment').fill(words);
  await page.getByRole('form', { name: 'New comment' }).getByRole('button', { name: 'Comment', exact: true }).click();
}

test('select words, press Comment: the words are underlined and the thread is under the text with its two buttons; the underline stays on the same words when text is added above', async ({ page, app }) => {
  const note = await openNote(page, app);
  await comment(page, 'Price it as a fixed package', 'Is this price too low for Nordlicht?');
  const thread = page.getByRole('article', { name: 'Comment on “Price it as a fixed package”' });
  await expect(thread).toContainText('Is this price too low for Nordlicht?');
  await expect(thread.getByRole('button', { name: 'Ask my assistant now' })).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Later', exact: true })).toBeVisible();
  await expect(text(page).locator('.has-comment')).toHaveText('Price it as a fixed package');
  expect((await threadsOf(app, note.id))[0]).toMatchObject({ anchor: 'Price it as a fixed package', author: 'me', ask: '' });

  await text(page).getByText('Three parts', { exact: true }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('A new bullet above. ');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(text(page).locator('.has-comment')).toHaveText('Price it as a fixed package'); // the same words
});

test('Ask my assistant now: its answer is a reply in the thread, signed as the assistant, and the same turn is in the Assistant', async ({ page, app }) => {
  const note = await openNote(page, app);
  await comment(page, 'Price it as a fixed package', 'Is this price too low?');
  const thread = page.getByRole('article', { name: /Comment on/ });
  await thread.getByRole('button', { name: 'Ask my assistant now' }).click();
  await expect(thread.locator('.comment-reply[data-author="assistant"]')).toContainText('Not too low if the prep is included.');
  await expect(thread.locator('.comment-reply strong')).toHaveText('Your assistant ');
  await expect(thread.getByRole('button', { name: 'Ask my assistant now' })).toHaveCount(0); // answered
  const chats = await fetch(`${app.url}/api/conversations`).then((r) => r.json());
  expect(chats.length).toBe(1);
  await thread.getByRole('link', { name: 'See the turn in the Assistant' }).click();
  await expect(page).toHaveURL(/\/assistant\//);
  await expect(page.locator('.chat-bubble[data-role="user"]')).toContainText('Price it as a fixed package');
  expect((await threadsOf(app, note.id))[0]).toMatchObject({ ask: 'answered' });
});

test('Later: it waits on your assistant’s list, and "go through my comments" answers each in its thread', async ({ page, app }) => {
  const note = await openNote(page, app);
  await comment(page, 'Two quiet mornings', 'Why only mornings?');
  const thread = page.getByRole('article', { name: /Comment on/ });
  await thread.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(thread.getByRole('button', { name: 'Later: on your assistant’s list' })).toBeDisabled();
  expect((await threadsOf(app, note.id))[0].ask).toBe('later');

  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Please go through my comments');
  await input.press('Enter');
  await expect(page.locator('.chat-bubble[data-role="assistant"]').last()).toContainText('I went through 1 comment');
  const [after] = await threadsOf(app, note.id);
  expect([after.ask, after.replies.length, after.replies[0].author]).toEqual(['answered', 1, 'assistant']);
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(page.getByRole('article', { name: /Comment on/ }).locator('.comment-reply')).toContainText('noted, here is my answer');
});

test('you can reply, resolve (the underline goes) and reopen (it comes back), and delete', async ({ page, app }) => {
  const note = await openNote(page, app);
  await comment(page, 'Followed by the schedule', 'Which schedule?');
  const thread = page.getByRole('article', { name: /Comment on/ });
  await thread.getByLabel('Reply').fill('The one in the appendix.');
  await thread.getByRole('button', { name: 'Reply' }).click();
  await expect(thread.locator('.comment-reply')).toContainText('The one in the appendix.');
  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(text(page).locator('.has-comment')).toHaveCount(0);
  await thread.getByRole('button', { name: 'Reopen' }).click();
  await expect(text(page).locator('.has-comment')).toHaveCount(1);
  await thread.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('article', { name: /Comment on/ })).toHaveCount(0);
  expect(await threadsOf(app, note.id)).toEqual([]);
  expect((await fetch(`${app.url}/api/notes/${note.id}`).then((r) => r.json())).body).toBe(BODY); // the text was never touched
});

test('with the module off there is no Comment button and no pane', async ({ page, app }) => {
  const note = await app.createNote({ title: 'N', body: BODY });
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true'); // saved before the page is left
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).getByText('Two quiet mornings', { exact: true }).click({ clickCount: 3 });
  await expect(page.getByRole('button', { name: 'Comment on the selected words' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Comments' })).toHaveCount(0);
  void tapAtEnd;
});
