// Model and effort (module ai-pick): on in a new install; switched off, no choices show; on, the two choices sit
// above the box to ask in, the chat keeps them, and a line says when the model changed. The claude command is a
// stand-in (tests/fake-claude.js) that names the model it was asked for.
import { test, expect } from './fixtures.js';

const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);

test('choose a model and effort for a chat; a line shows the change', async ({ page, app }) => {
  await fetch(`${app.url}/api/modules`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'ai-pick', on: false }) });
  await page.goto(`${app.url}/assistant`);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model' })).toBeHidden();

  await fetch(`${app.url}/api/modules`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'ai-pick', on: true }) });
  await page.reload();
  const model = page.getByRole('combobox', { name: 'Model' });
  const effort = page.getByRole('combobox', { name: 'Effort' });
  await expect(model).toBeVisible();
  await expect(model).toHaveValue('');
  await expect(effort).toHaveValue('');

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Hello there');
  await input.press('Enter');
  await expect(bubbles(page, 'assistant')).toContainText('You said: Hello there');
  await expect(page.locator('.chat-switch')).toHaveText(['Started with Claude Opus 5.5']);

  await model.selectOption('haiku');
  await effort.selectOption('low');
  await expect.poll(async () => (await (await fetch(`${app.url}/api/assistant/pick?chat=${page.url().split('/').pop()}`)).json()).model).toBe('haiku');
  await input.fill('And now?');
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').nth(1)).toHaveAttribute('data-state', 'done');
  await expect(page.locator('.chat-switch')).toHaveText(['Started with Claude Opus 5.5', 'Switched to Claude Haiku 5.5']);

  // Kept for this chat, and a new chat starts with the last choice.
  await page.reload();
  await expect(model).toHaveValue('haiku');
  await expect(effort).toHaveValue('low');
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(model).toHaveValue('haiku');
});

test('with ChatGPT answering, the choices are ChatGPT’s own, and Claude’s are kept for later', async ({ page, app }) => {
  const put = (url, body) => fetch(`${app.url}${url}`, { method: url === '/api/modules' ? 'PATCH' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await put('/api/modules', { id: 'ai-pick', on: true });
  await put('/api/assistant/pick', { model: 'haiku' });
  await put('/api/assistant/ai', { provider: 'codex' });
  await page.goto(`${app.url}/assistant`);
  const model = page.getByRole('combobox', { name: 'Model' });
  await expect(model).toHaveValue('');
  await expect(model.locator('option')).toHaveText(['Usual · ChatGPT’s own choice', 'GPT-6 Luna · quick and light', 'GPT-6.1 Terra · balanced', 'GPT-6.1 Sol · everyday work', 'GPT-6 Astra · most capable, uses your plan fastest']);
  await model.selectOption('gpt-6-luna');
  await expect.poll(async () => (await (await fetch(`${app.url}/api/assistant/pick`)).json()).model).toBe('gpt-6-luna');
  await put('/api/assistant/ai', { provider: 'claude' });
  await page.reload();
  await expect(model).toHaveValue('haiku');
});
