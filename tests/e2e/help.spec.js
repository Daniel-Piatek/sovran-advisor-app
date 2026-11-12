// Help pages (module help, myICOR advanced/last/2 and 3): on in a new install (the test copy starts with it off); on, a "?" after
// every page title opens that page's help beside it, and /help lists every page.
import { test, expect } from './fixtures.js';

const switchOn = async (page, app) => {
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="help"]').getByRole('button', { name: 'On' }).click();
};

test('switched off: no "?" after a title', async ({ page, app }) => {
  await page.goto(`${app.url}/`);
  await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
  await expect(page.locator('.help-button')).toHaveCount(0);
  await page.goto(`${app.url}/help`);
  await expect(page.getByText('Help pages are switched off.')).toBeVisible();
});

test('switch it on: the "?" opens the page beside it, How it works folded, Esc closes it', async ({ page, app }) => {
  await switchOn(page, app);
  await page.goto(`${app.url}/`);
  const help = page.getByRole('button', { name: 'Help: Notes' });
  await expect(help).toBeVisible();
  await help.click();
  const pane = page.getByRole('complementary', { name: 'Help' });
  await expect(pane.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(pane).toContainText('It saves by itself as you type');
  const how = pane.locator('details.help-how');
  await expect(how).not.toHaveAttribute('open', '');
  await how.locator('summary').click();
  await expect(how).toContainText('notes-screens.js');
  await page.keyboard.press('Escape');
  await expect(pane).toBeHidden();

  // Another view has its own page; a view whose module is off has no "?" (and is not in the sidebar).
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Inbox' }).click();
  await page.getByRole('button', { name: 'Help: Inbox' }).click();
  await expect(pane).toContainText('Empty it once a day');
});

test('/help lists every page of the modules that are on, and opens one', async ({ page, app }) => {
  await switchOn(page, app);
  await page.goto(`${app.url}/help`);
  await expect(page.getByRole('link', { name: 'Journal' }).last()).toBeVisible();
  await page.locator('.help-list-link', { hasText: 'Assistant' }).click();
  await expect(page).toHaveURL(/\/help\/assistant$/);
  await expect(page.getByRole('heading', { name: 'Assistant', level: 1 })).toBeVisible();
  await expect(page.locator('details.help-how')).toHaveAttribute('open', '');
});
