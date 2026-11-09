// Settings › Import (advanced/writing/9): an Obsidian folder and a Day One export, through the page. Everything is made up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures.js';

function vault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  const root = path.join(dir, 'Autumn vault');
  fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Pricing thoughts.md'), '---\ntags: x\n---\n* Package: 3 days for 4800 EUR\n');
  fs.writeFileSync(path.join(root, 'Pricing history.md'), 'See [[Pricing thoughts]].\n');
  fs.writeFileSync(path.join(root, 'Workshop venues in Hamburg.md'), 'The harbour loft.\n');
  fs.writeFileSync(path.join(root, '.obsidian', 'app.md'), 'not a note');
  return root;
}
function dayOne() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dayone-')), 'Journal.json');
  fs.writeFileSync(file, JSON.stringify({ entries: [
    { uuid: 'A1', creationDate: '2026-09-03T08:15:00Z', timeZone: 'Europe/Athens', text: 'First morning.' },
    { uuid: 'B2', creationDate: '2026-09-04T07:00:00Z', timeZone: 'Europe/Athens', text: 'The next day.' },
  ] }));
  return file;
}
const part = (page) => page.getByRole('region', { name: 'Import' });

test('choose a folder: the report says 3 imported; a second run says none imported, three already here, none doubled', async ({ page, app }) => {
  const root = vault();
  await page.goto(`${app.url}/settings`);
  await page.getByLabel('Choose an Obsidian folder').setInputFiles(root);
  const first = part(page).getByRole('article', { name: /Import report: Obsidian folder/ });
  await expect(first).toContainText('Autumn vault');
  await expect(first.locator('dt:text-is("Imported") + dd')).toHaveText('3');
  await expect(first.locator('dt:text-is("Doubled") + dd')).toHaveText('0');

  await page.getByLabel('Choose an Obsidian folder').setInputFiles(root);
  await expect(part(page).getByRole('article', { name: /Import report: Obsidian folder/ })).toHaveCount(2);
  const second = part(page).getByRole('article', { name: /Import report: Obsidian folder/ }).first();
  await expect(second.locator('dt:text-is("Imported") + dd')).toHaveText('0');
  await expect(second.locator('dt:text-is("Already here") + dd')).toHaveText('3');
  await expect(second.locator('dt:text-is("Doubled") + dd')).toHaveText('0');

  const notes = await fetch(`${app.url}/api/notes?q=harbour`).then((r) => r.json());
  expect(notes.length).toBe(1);
  await page.goto(`${app.url}/notes/${notes[0].id}`);
  await expect(page.getByLabel('Text')).toHaveText('The harbour loft.');
  await expect(page.locator('.note-info')).toContainText('Autumn vault/Workshop venues in Hamburg.md');
});

test('a note you changed after it came in is kept: the second report says so', async ({ page, app }) => {
  const root = vault();
  await page.goto(`${app.url}/settings`);
  await page.getByLabel('Choose an Obsidian folder').setInputFiles(root);
  await expect(part(page).getByRole('article')).toHaveCount(1);
  const [venues] = await fetch(`${app.url}/api/notes?q=harbour`).then((r) => r.json());
  await new Promise((resolve) => setTimeout(resolve, 20));
  await app.updateNote(venues.id, { body: 'The harbour loft. Book by Friday.' });
  await page.getByLabel('Choose an Obsidian folder').setInputFiles(root);
  const second = part(page).getByRole('article').first();
  await expect(second.locator('dt:text-is("Kept (you edited them)") + dd')).toHaveText('1');
  await expect(second).toContainText('Workshop venues in Hamburg');
  expect((await fetch(`${app.url}/api/notes/${venues.id}`).then((r) => r.json())).body).toBe('The harbour loft. Book by Friday.');
});

test('choose a Day One export: entries on their days; the second run adds nothing', async ({ page, app }) => {
  const file = dayOne();
  await page.goto(`${app.url}/settings`);
  await page.getByLabel('Choose a Day One export').setInputFiles(file);
  const first = part(page).getByRole('article', { name: /Day One export/ });
  await expect(first.locator('dt:text-is("Entries added") + dd')).toHaveText('2');
  await expect(first.locator('dt:text-is("Days covered") + dd')).toHaveText('2');
  await page.getByLabel('Choose a Day One export').setInputFiles(file);
  await expect(part(page).getByRole('article', { name: /Day One export/ })).toHaveCount(2);
  const second = part(page).getByRole('article', { name: /Day One export/ }).first();
  await expect(second.locator('dt:text-is("Entries added") + dd')).toHaveText('0');
  await expect(second.locator('dt:text-is("Already here") + dd')).toHaveText('2');
  await page.goto(`${app.url}/journal/2026-09-03`);
  await expect(page.getByText('First morning.')).toBeVisible();
});

test('the Library shows the report; switched off there is no Import part', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('article', { name: /Import report: Obsidian folder/ }).first()).toContainText('Left as you wrote them: Workshop venues in Hamburg');
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' }).click();
  await expect(part(page)).toHaveCount(0);
});
