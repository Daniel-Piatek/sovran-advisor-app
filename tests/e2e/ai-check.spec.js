// The Check button under Settings › Your assistant’s AI: one plain result, and for a problem every step to fix it.
// The claude command is a stand-in (tests/fake-claude.js); a test sets its sign-in in the data folder.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';

const part = (page) => page.getByRole('region', { name: 'Which AI' });

test('Check says the assistant works', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  await part(page).getByRole('button', { name: 'Check', exact: true }).click();
  await expect(part(page).locator('.ai-check-result')).toHaveAttribute('data-result', 'working');
  await expect(part(page).locator('.ai-check-title')).toHaveText('✓ Your assistant works. Claude Code is installed, signed in (Claude Pro plan) and answered.');
  await expect(part(page).getByRole('button', { name: 'Check again' })).toBeVisible();
});

test('not signed in: every step, the line to type, then Check again works', async ({ page, app }) => {
  const auth = path.join(app.dataDir, 'fake-claude-auth.json');
  fs.writeFileSync(auth, JSON.stringify({ loggedIn: false, authMethod: 'none' }));
  await page.goto(`${app.url}/settings`);
  await part(page).getByRole('button', { name: 'Check', exact: true }).click();
  const result = part(page).locator('.ai-check-result');
  await expect(result).toHaveAttribute('data-result', 'signed_out');
  await expect(result.locator('.ai-check-title')).toHaveText('Claude Code isn’t signed in to your Claude account.');
  await expect(result).toContainText('Open Terminal');
  await expect(result).toContainText('Finder');
  await expect(result).toContainText('Authorize');
  await expect(result).toContainText('Login successful');
  await expect(result.locator('.ai-check-line code')).toHaveText('claude auth login');
  await part(page).screenshot({ path: test.info().outputPath('signed-out.png') });

  fs.rmSync(auth);
  await part(page).getByRole('button', { name: 'Check again' }).click();
  await expect(result).toHaveAttribute('data-result', 'working');
});

test('a Free plan: upgrade, then sign in again', async ({ page, app }) => {
  fs.writeFileSync(path.join(app.dataDir, 'fake-claude-auth.json'), JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'free' }));
  await page.goto(`${app.url}/settings`);
  await part(page).getByRole('button', { name: 'Check', exact: true }).click();
  const result = part(page).locator('.ai-check-result');
  await expect(result).toHaveAttribute('data-result', 'free');
  await expect(result.getByRole('link', { name: 'Open Claude’s plans page' })).toHaveAttribute('href', 'https://claude.com/pricing');
  await expect(result).toContainText('Authorize');
});
