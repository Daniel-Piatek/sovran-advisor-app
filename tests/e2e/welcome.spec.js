import { test, expect } from './fixtures.js';

test('a new install opens on the welcome; a first step opens its page and the welcome is not shown again', async ({ page, app }) => {
  await fetch(`${app.url}/api/welcome`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: false }) });
  await page.goto(app.url);
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Sovran Advisor');
  await expect(page.getByText('Your trusty companion on your Sovran Quest journey.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveAttribute('placeholder', 'Type your name here.');
  // One first step only, and nothing after it (2026-11-10, the owner's wish).
  await expect(page.locator('.welcome-step')).toHaveCount(1);
  await expect(page.getByText('More when you want it')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ana');
  await expect(page.getByRole('region', { name: 'What to call you' }).getByRole('status')).toHaveText('Saved.');
  await page.getByRole('link', { name: /Write your first journal entry/ }).click();
  await expect(page).toHaveURL(/\/journal$/);
  await expect.poll(async () => (await (await fetch(`${app.url}/api/welcome`)).json()).seen).toBe(true);
  await page.goto(app.url);
  await expect(page).not.toHaveURL(/\/welcome$/);
  await page.goto(`${app.url}/welcome`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ana');
});

test('Settings: the assistant’s AI is Claude, or ChatGPT; the choice holds and the welcome follows it', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Which AI' });
  await expect(part.getByRole('button', { name: 'Claude' })).toHaveAttribute('aria-pressed', 'true');
  await expect(part.getByRole('status')).toHaveText('Your assistant runs on your own Claude (Claude Code), on this computer.');
  await part.getByRole('button', { name: 'ChatGPT' }).click();
  await expect(part.getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-pressed', 'true');
  await expect(part.getByRole('status')).toHaveText('Your assistant runs on your own ChatGPT (Codex), on this computer.');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Which AI' }).getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/welcome`);
  await expect(page.getByText('Ready. It runs on your own ChatGPT, on this computer.')).toBeVisible();
  // The assistant answers with ChatGPT now.
  const conversation = await (await fetch(`${app.url}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  await page.goto(`${app.url}/assistant/${conversation.id}`);
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello from ChatGPT');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(page.getByText('You said: Hello from ChatGPT')).toBeVisible();
  await fetch(`${app.url}/api/assistant/ai`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'claude' }) });
});

test('each answer names the AI and model that gave it; a chat says which it started with and where it switched', async ({ page, app }) => {
  const put = (provider) => fetch(`${app.url}/api/assistant/ai`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
  await put('claude');
  await page.goto(`${app.url}/assistant`);
  const box = page.getByRole('textbox', { name: 'Message' });
  await expect(box).toHaveAttribute('placeholder', 'Ask your assistant (Claude)');
  await box.fill('Hello one');
  await box.press('Enter');
  await expect(page.getByText('You said: Hello one')).toBeVisible();
  const log = page.getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.chat-switch').first()).toHaveText('Started with Claude Opus 5.5');
  await expect(log.locator('.chat-bubble.is-assistant .chat-ai').first()).toHaveText('Claude Opus 5.5');
  await put('codex');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Ask your assistant (ChatGPT)');
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello two');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(page.getByText('You said: Hello two')).toBeVisible();
  await expect(log.locator('.chat-bubble.is-assistant .chat-ai').last()).toHaveText('ChatGPT (GPT-6.1 Sol)');
  await page.reload();
  await expect(page.getByRole('log', { name: 'Conversation' }).locator('.chat-switch')).toHaveText(['Started with Claude Opus 5.5', 'Switched to ChatGPT (GPT-6.1 Sol)']);
  await expect(page.getByRole('navigation', { name: 'Your chats' }).locator('.chat-ai').first()).toHaveText('ChatGPT');
  await put('claude');
});
