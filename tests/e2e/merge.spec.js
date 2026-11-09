// You and your assistant at once (advanced/writing/5). The "assistant" changes the note through the API while the page is open on it.
import { test, expect, tapAtEnd } from './fixtures.js';

const BODY = 'Three parts\n\ntwo quiet mornings\n\nFollow up';
const text = (page) => page.getByLabel('Text');
const noteOf = (app, id) => fetch(`${app.url}/api/notes/${id}`).then((r) => r.json());
const versionsOf = (app, id) => fetch(`${app.url}/api/notes/${id}/versions`).then((r) => r.json());

async function openNote(page, app) {
  const note = await app.createNote({ title: 'Proposal outline', body: BODY });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(text(page)).toContainText('Three parts');
  return note;
}

test('your assistant adds a line at the end while you change the first: both are in the note as one merged version, and the page shows both', async ({ page, app }) => {
  const note = await openNote(page, app);
  await app.updateNote(note.id, { body: `${BODY}\n\nSend the contract` }); // the other side saves under your page
  await text(page).getByText('Three parts', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(', in detail');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, note.id)).body).toBe('Three parts, in detail\n\ntwo quiet mornings\n\nFollow up\n\nSend the contract');
  await expect(text(page)).toContainText('Send the contract'); // the page took the merged text
  expect((await versionsOf(app, note.id))[0]).toMatchObject({ seq: 3, label: 'Merged' });
  await expect(page.locator('.clash-box')).toHaveCount(0);
});

test('both changed the same line: a clash box with both sides; Keep yours is a new version, the assistant is told which side won', async ({ page, app }) => {
  const note = await openNote(page, app);
  await app.updateNote(note.id, { body: 'Three parts\n\nmeetings only after lunch\n\nFollow up' });
  await text(page).getByText('two quiet mornings', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(', no calls');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const box = page.getByRole('region', { name: 'A line you and your assistant both changed' });
  await expect(box.locator('[data-side="mine"]')).toContainText('two quiet mornings, no calls');
  await expect(box.locator('[data-side="theirs"]')).toContainText('meetings only after lunch');
  expect((await noteOf(app, note.id)).body).toBe('Three parts\n\ntwo quiet mornings, no calls\n\nFollow up'); // yours is in the note

  await box.getByRole('button', { name: 'Keep yours' }).click();
  await expect(page.locator('.clash-box')).toHaveCount(0);
  expect((await versionsOf(app, note.id))[0].label).toBe('Kept yours');

  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Please go on with the note');
  await input.press('Enter');
  await expect(page.locator('.chat-bubble[data-role="assistant"]').last()).toContainText('the owner\'s words won: “two quiet mornings, no calls”');
  await expect(page.locator('.chat-bubble[data-role="assistant"]').last()).toHaveAttribute('data-state', 'done');
  await expect(page.locator('.chat-bubble[data-role="user"]').last()).not.toContainText('Note from the app'); // not written by you
  await input.fill('And again, go on with the note');
  await input.press('Enter');
  await expect(page.locator('.chat-bubble[data-role="assistant"]').last()).toContainText('Going on with the note.'); // told once
});

test('Take the assistant’s and Keep both change the line', async ({ page, app }) => {
  for (const [button, expected] of [['Take the assistant’s', 'Three parts\n\nmeetings only after lunch\n\nFollow up'], ['Keep both', 'Three parts\n\ntwo quiet mornings, no calls\n\nmeetings only after lunch\n\nFollow up']]) {
    const note = await openNote(page, app);
    await app.updateNote(note.id, { body: 'Three parts\n\nmeetings only after lunch\n\nFollow up' });
    await text(page).getByText('two quiet mornings', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(', no calls');
    await expect(page.getByRole('status')).toHaveText('Saved');
    await page.getByRole('region', { name: 'A line you and your assistant both changed' }).getByRole('button', { name: button }).click();
    await expect(page.locator('.clash-box')).toHaveCount(0);
    await expect.poll(async () => (await noteOf(app, note.id)).body).toBe(expected);
    await expect(text(page)).toContainText('meetings only after lunch');
  }
});

test('with the module off a save is a plain save', async ({ page, app }) => {
  const note = await app.createNote({ title: 'N', body: BODY });
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' }).click();
  await page.goto(`${app.url}/notes/${note.id}`);
  await tapAtEnd(text(page));
  await page.keyboard.type(' x');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, note.id)).body).toBe(`${BODY} x`);
});
