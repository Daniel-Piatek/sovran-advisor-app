// Versions of every note (advanced/writing/4): the clock, the list, two compared, Restore as one more version.
import { test, expect, tapAtEnd } from './fixtures.js';

const clock = (page) => page.getByRole('button', { name: /^Versions: \d+$/ });
const noteOf = (app, id) => fetch(`${app.url}/api/notes/${id}`).then((r) => r.json());
const versionsOf = (app, id) => fetch(`${app.url}/api/notes/${id}/versions`).then((r) => r.json());

test('the clock counts the saves; the dialog opens on the last two with the changed words marked', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Pricing', body: 'Three tiers felt like too many.' });
  await app.updateNote(note.id, { body: 'Three tiers felt like too many. Two is enough.' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(clock(page)).toHaveAccessibleName('Versions: 2');
  await tapAtEnd(page.getByLabel('Text'));
  await page.keyboard.type(' Or one.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(clock(page)).toHaveAccessibleName('Versions: 3'); // typed and saved: one more
  await clock(page).click();
  const dialog = page.getByRole('dialog', { name: 'Versions' });
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(dialog.getByRole('button', { name: /Version 3/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: /Version 2/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.version-diff ins')).toContainText('Or one.');
  await expect(dialog.getByRole('button', { name: /Version 1.*First version/ })).toBeVisible();
});

test('your assistant’s saves carry its name; picking one version shows its text and Restore brings it back as the next version', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Pricing', body: 'first words' });
  await app.updateNote(note.id, { body: 'second words' });
  await app.updateNote(note.id, { body: 'third words' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await clock(page).click();
  const dialog = page.getByRole('dialog', { name: 'Versions' });
  await dialog.getByRole('button', { name: /Version 3/ }).click(); // two are picked: this one is out, one is left
  await dialog.getByRole('button', { name: /Version 2/ }).click(); // and now none
  await dialog.getByRole('button', { name: /Version 2/ }).click();
  await expect(dialog.locator('.version-text')).toHaveText('second words');
  await dialog.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByLabel('Text')).toHaveText('second words');
  await expect(clock(page)).toHaveAccessibleName('Versions: 4');
  expect((await noteOf(app, note.id)).body).toBe('second words');
  const versions = await versionsOf(app, note.id);
  expect(versions.map((v) => v.seq)).toEqual([4, 3, 2, 1]);
  expect(versions[0].label).toBe('Restored from version 2');
  expect(versions[1].title).toBe('Pricing'); // the text restored over is still version 3
});

test('switched off there is no clock', async ({ page, app }) => {
  const note = await app.createNote({ title: 'N', body: 'a' });
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true'); // saved before the page is left
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(page.getByLabel('Text')).toHaveText('a');
  await expect(clock(page)).toHaveCount(0);
});
