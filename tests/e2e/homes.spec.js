import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const chip = (page) => page.locator('.home');

test('a note gets a home from the chip, and still shows it after closing and opening the app', async ({ page, app }) => {
  await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const workshop = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Autumn workshop' });
  await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Old pricing', state: 'archived' });
  const note = await app.createNote({ title: 'Ideas for the autumn workshop' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(chip(page)).toHaveText('HomeNo home yet');
  await page.getByRole('button', { name: 'Give it a home' }).click();
  const options = page.getByRole('listbox', { name: 'Homes' }).getByRole('option');
  await expect(options).toHaveText(['Autumn workshopproject', 'WorkKey Element']); // Projects first; no archived ones
  await page.keyboard.type('autumn');
  await expect(options).toHaveText(['Autumn workshopproject']);
  await page.keyboard.press('Enter');
  await expect(chip(page)).toHaveText('HomeAutumn workshop');
  await expect(page.getByRole('status')).toHaveText('Saved');

  await page.close();
  const again = await page.context().newPage();
  await again.goto(`${app.url}/notes/${note.id}`);
  await expect(chip(again)).toHaveText('HomeAutumn workshop');
  await expect(chip(again).locator('.home-name svg')).toBeVisible(); // the Project's flag
  await chip(again).getByRole('link', { name: 'Autumn workshop' }).click();
  await expect(again).toHaveURL(new RegExp(`/life/${workshop.id}$`));
});

test('the home can be changed or taken away; Escape and a click elsewhere close the picker', async ({ page, app }) => {
  const a = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Autumn workshop' });
  await send(app, 'POST', '/api/life', { kind: 'project', title: 'Nordlicht onboarding' });
  const note = await app.createNote({ title: 'Questions for the accountant' });
  await app.updateNote(note.id, { home_id: a.id });
  await page.goto(`${app.url}/notes/${note.id}`);
  const picker = page.getByRole('listbox', { name: 'Homes' });
  await page.getByRole('button', { name: 'Change the home' }).click();
  await expect(picker.getByRole('option', { name: /Autumn workshop/ })).toContainText('its home');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(page.getByRole('button', { name: 'Change the home' })).toBeFocused();
  await page.getByRole('button', { name: 'Change the home' }).click();
  await page.locator('.note-info').click();
  await expect(picker).toBeHidden();

  await page.getByRole('button', { name: 'Change the home' }).click();
  await picker.getByRole('option', { name: /Nordlicht onboarding/ }).click();
  await expect(chip(page)).toHaveText('HomeNordlicht onboarding');
  await page.getByRole('button', { name: 'Change the home' }).click();
  await picker.getByRole('option', { name: 'No home' }).click();
  await expect(chip(page)).toHaveText('HomeNo home yet');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await send(app, 'GET', `/api/notes/${note.id}`)).home_id).toBe(null);
});

test('with My Life empty, the picker says where to start', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Loose note' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByRole('button', { name: 'Give it a home' }).click();
  await expect(page.getByText('My Life is empty. Add a Key Element, Goal, Project or Topic there first.')).toBeVisible();
});

const atHome = (page) => page.getByRole('region', { name: 'Notes at home here' });

test('moving a note: it leaves the first home’s list and stands in the second', async ({ page, app }) => {
  const workshop = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Autumn workshop' });
  const onboarding = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Nordlicht onboarding' });
  const ideas = await app.createNote({ title: 'Ideas for the autumn workshop', body: 'Three tiers, a half day each.' });
  await app.updateNote(ideas.id, { home_id: workshop.id });
  const questions = await app.createNote({ title: 'Questions for the accountant' });

  await page.goto(`${app.url}/life/${onboarding.id}`);
  await expect(atHome(page).getByText('No notes here yet.')).toBeVisible();
  await page.goto(`${app.url}/notes/${questions.id}`);
  await page.getByRole('button', { name: 'Give it a home' }).click();
  await page.getByRole('option', { name: /Autumn workshop/ }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await chip(page).getByRole('link', { name: 'Autumn workshop' }).click();
  await expect(atHome(page).getByRole('heading')).toHaveText('Notes at home here · 2');
  await expect(atHome(page).locator('.life-item-title')).toHaveText(['Questions for the accountant', 'Ideas for the autumn workshop']);

  await atHome(page).getByRole('link', { name: /Ideas for the autumn workshop/ }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${ideas.id}$`));
  await page.getByRole('button', { name: 'Change the home' }).click();
  await page.getByRole('option', { name: /Nordlicht onboarding/ }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.goto(`${app.url}/life/${workshop.id}`);
  await expect(atHome(page).locator('.life-item-title')).toHaveText(['Questions for the accountant']);
  await page.goto(`${app.url}/life/${onboarding.id}`);
  await expect(atHome(page).locator('.life-item-title')).toHaveText(['Ideas for the autumn workshop']);
});

test('a home shows its first twenty notes, newest first, and Show more brings the rest', async ({ page, app }) => {
  const topic = await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Pricing' });
  for (let i = 1; i <= 23; i++) await app.updateNote((await app.createNote({ title: `Note ${i}` })).id, { home_id: topic.id });
  await page.goto(`${app.url}/life/${topic.id}`);
  const rows = atHome(page).locator('.life-item-title');
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toHaveText('Note 23');
  await atHome(page).getByRole('button', { name: 'Show more (3)' }).click();
  await expect(rows).toHaveCount(23);
  await expect(rows.last()).toHaveText('Note 1');
  await expect(atHome(page).getByRole('button')).toHaveCount(0);
});
