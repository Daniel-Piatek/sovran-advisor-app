// The assistant (assistant/1). The claude command is a stand-in (tests/fake-claude.js):
// no test depends on a real AI model.
import { test, expect } from './fixtures.js';

const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);

async function openAssistant(page, app, info) {
  await page.goto(app.url);
  if (info.project.name === 'phone') {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Assistant' }).click();
  } else {
    await page.getByRole('link', { name: 'Assistant' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Assistant' })).toBeVisible();
}

test('ask what is in this folder: the question on the right, the answer streams in on the left', async ({ page, app }, info) => {
  await openAssistant(page, app, info);
  await page.getByRole('textbox', { name: 'Message' }).fill('What is in this folder?');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(bubbles(page, 'user')).toHaveText(['What is in this folder?']);
  await expect(bubbles(page, 'assistant')).toContainText('This folder is empty so far.');
  await expect(bubbles(page, 'assistant')).toHaveAttribute('data-state', 'done');
  await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]{36}$/);
  const user = await bubbles(page, 'user').boundingBox();
  const answer = await bubbles(page, 'assistant').boundingBox();
  expect(user.x + user.width).toBeGreaterThan(answer.x + answer.width); // yours on the right
  await expect(page.getByRole('navigation', { name: 'Your chats' }).getByRole('link', { name: 'What is in this folder?' })).toBeVisible();
});

test('the conversation is kept: reopen it and ask a follow-up; Claude remembers', async ({ page, app }) => {
  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Hello there');
  await input.press('Enter');
  await expect(bubbles(page, 'assistant')).toContainText('You said: Hello there');
  await page.reload();
  await expect(bubbles(page, 'user')).toHaveText(['Hello there']);
  await expect(bubbles(page, 'assistant')).toContainText(['You said: Hello there']);
  await input.fill('What did I ask?');
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toContainText('You asked: Hello there');
  await page.goto(`${app.url}/assistant`);
  await expect(bubbles(page, 'user')).toHaveCount(0);
  await page.getByRole('link', { name: 'Hello there' }).click();
  await expect(bubbles(page, 'user')).toHaveCount(2);
});

test('ask it to make a file: the step and the file show under the answer, folded', async ({ page, app }) => {
  await page.goto(`${app.url}/assistant`);
  await page.getByRole('textbox', { name: 'Message' }).fill('Please make a file notes.txt');
  await page.getByRole('button', { name: 'Send' }).click();
  const answer = bubbles(page, 'assistant');
  await expect(answer).toContainText('Made notes.txt.');
  const steps = answer.locator('.chat-steps');
  await expect(steps.locator('summary')).toHaveText('1 step · 1 file');
  await expect(steps.locator('.chat-step')).toBeHidden(); // folded by default
  await steps.locator('summary').click();
  await expect(steps.locator('.chat-step')).toHaveText(['Wrotenotes.txt']);
  await expect(steps.locator('.chat-files')).toHaveText('notes.txt');
});

test('Stop ends the answer and keeps what came; then you can ask again', async ({ page, app }) => {
  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('slow please');
  await input.press('Enter');
  await expect(bubbles(page, 'assistant')).toContainText('word3');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(bubbles(page, 'assistant')).toHaveAttribute('data-state', 'stopped');
  await expect(bubbles(page, 'assistant')).toContainText('Stopped.');
  await expect(bubbles(page, 'assistant')).not.toContainText('word50');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await input.fill('Still there?');
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toContainText('You said: Still there?');
});

test('a chat deleted comes back with Undo', async ({ page, app }) => {
  await page.goto(`${app.url}/assistant`);
  await page.getByRole('textbox', { name: 'Message' }).fill('What is on today?');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(bubbles(page, 'assistant')).toHaveAttribute('data-state', 'done');
  await page.getByRole('button', { name: 'Delete chat' }).click();
  await expect(page.getByRole('navigation', { name: 'Your chats' })).toContainText('No chats yet.');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(bubbles(page, 'user')).toHaveText(['What is on today?']);
});

test('a chat can be renamed; the top bar stays "Assistant" and the chosen chat is marked', async ({ page, app }) => {
  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('A very long first question that would have filled the whole top of the page if it were the title');
  await input.press('Enter');
  await expect(bubbles(page, 'assistant')).toContainText('You said:');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Assistant');
  await expect(page.locator('.chat-list-item[aria-current="page"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rename chat' }).click();
  await page.getByRole('textbox', { name: 'Chat name' }).fill('Workshop plan');
  await page.getByRole('textbox', { name: 'Chat name' }).press('Enter');
  await expect(page.getByRole('navigation', { name: 'Your chats' }).getByRole('link', { name: 'Workshop plan' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Your chats' }).getByRole('link', { name: 'Workshop plan' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Assistant');
});
