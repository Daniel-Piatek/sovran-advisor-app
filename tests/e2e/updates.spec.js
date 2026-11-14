// Settings › Updates (app-update.js; the update itself is tested in tests/unit/app-update.test.js with a real git copy):
// the box is there near the top of Settings and always offers a way to update, by the button or by the Claude Code line.
import { test, expect } from './fixtures.js';

test('Settings › Updates: the box shows how to get the newest version', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Updates' });
  await expect(part).toBeVisible();
  await expect(part.getByRole('heading', { name: 'Updates' })).toBeVisible();
  // A copy that can update itself offers Check for updates; one that can't (this test copy may be on its own branch)
  // offers the one line to paste into Claude Code.
  await expect(part.getByRole('button', { name: 'Check for updates' }).or(part.getByText('Update Sovran Advisor by following'))).toBeVisible();
  const status = await fetch(`${app.url}/api/update`).then((r) => r.json());
  expect(status.update_line).toContain('INSTALL.md');
  expect(status.progress).toBeNull();
});
