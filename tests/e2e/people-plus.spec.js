import { test, expect, newEntry } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const menu = (page) => page.getByRole('listbox', { name: 'Mention' });
const allTasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());

test('@ in the add bar: pick Lena, Enter adds the task, the row shows her as a face and a name, and her page lists it', async ({ page, app }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await page.goto(`${app.url}/tasks`);
  const bar = page.getByLabel('Add a task');
  await bar.focus();
  await page.keyboard.type('Ring @len');
  await expect(menu(page).getByRole('option').first()).toContainText('Lena Fischer');
  await expect(menu(page).getByRole('option').first()).toContainText('person');
  await page.keyboard.press('Enter'); // takes the name; does not add the task yet
  await expect(bar).toHaveValue('Ring Lena Fischer ');
  await expect(menu(page)).toBeHidden();
  expect(await allTasks(app)).toEqual([]);
  await expect(page.locator('.tasks-page .quick-chips .mention-chip')).toHaveText('LFLena Fischer');
  await page.keyboard.type('about March');
  await page.keyboard.press('Enter'); // now it adds
  await expect(page.getByText('Added “Ring Lena Fischer about March”', { exact: false })).toBeVisible();

  const [task] = await allTasks(app);
  expect([task.text, task.mentions]).toEqual(['Ring Lena Fischer about March', [{ kind: 'person', id: lena.id, name: 'Lena Fischer' }]]);
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('7'); // All
  const words = page.locator('.task-row .task-words').filter({ hasText: 'about March' });
  await expect(words.locator('a.mention-chip .page-link-person')).toHaveText('LF');
  await expect(words.locator('a.mention-chip')).toHaveAttribute('href', `/people/${lena.id}`);
  await expect(words).toContainText('Ring LFLena Fischer about March');

  await words.locator('a.mention-chip').click();
  await expect(page).toHaveURL(`${app.url}/people/${lena.id}`);
  const mentioned = page.getByRole('region', { name: 'Mentioned in' });
  await expect(mentioned.getByRole('heading')).toHaveText('Mentioned in · 1');
  await expect(mentioned.locator('.linked-from-context')).toHaveText('Ring Lena Fischer about March');
  await mentioned.locator('.linked-from-row').click();
  await expect(page).toHaveURL(`${app.url}/tasks`);
});

test('@@ in a task’s edit strip adds a company, and Escape closes the menu before it closes the strip', async ({ page, app }) => {
  await send(app, 'POST', '/api/companies', { name: 'Nordlicht Studio' });
  await send(app, 'POST', '/api/tasks', { text: 'Send the offer' });
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('7'); // All
  await page.locator('.task-row .task-words').filter({ hasText: 'Send the offer' }).click();
  const edit = page.getByLabel('The task’s words');
  await expect(edit).toBeFocused();
  await edit.press('End');
  await page.keyboard.type(' to @@nord');
  await expect(menu(page).getByRole('option').first()).toContainText('Nordlicht Studio');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(edit).toBeVisible(); // the strip stayed open
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace'); // takes "@@nord" away
  await page.keyboard.type('@nord');
  await expect(menu(page)).toBeVisible(); // a single @ shows people only; none match, so only "New person"
  await expect(menu(page).getByRole('option')).toHaveText([/New person “nord”/]);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('@@nord');
  await page.keyboard.press('Enter');
  await expect(edit).toHaveValue('Send the offer to Nordlicht Studio ');
  await page.keyboard.press('Enter'); // closes the strip and keeps the words
  await expect(edit).toBeHidden();
  const [task] = await allTasks(app);
  expect([task.text, task.mentions.map((m) => [m.kind, m.name])]).toEqual(['Send the offer to Nordlicht Studio', [['company', 'Nordlicht Studio']]]);
  await expect(page.locator('.task-row .mention-chip .page-link-company')).toHaveText('N');
});

test('Settings › Modules: switching People in depth off takes away the @ menu and the faces, and keeps every word', async ({ page, app }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await send(app, 'POST', '/api/tasks', { text: 'Ring Lena Fischer', mentions: [{ kind: 'person', id: lena.id }] });
  const note = await app.createNote({ title: 'Met', body: `Rang [Lena Fischer](/people/${lena.id}) today.` });

  await page.goto(`${app.url}/settings`);
  const row = page.locator('[data-module="people-plus"]');
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible();
  await expect(row).toContainText('People in depth');
  await expect(row.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Off' }).click();
  await expect(row.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  expect((await send(app, 'GET', '/api/modules')).find((m) => m.id === 'people-plus').on).toBe(false);

  // The task's row: her name as plain words.
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('7');
  const words = page.locator('.task-row .task-words').filter({ hasText: 'Ring Lena Fischer' });
  await expect(words).toHaveText('Ring Lena Fischer');
  await expect(words.locator('.mention-chip')).toHaveCount(0);
  // The add bar and the editor: @ is just a letter.
  await page.keyboard.press('q');
  await page.keyboard.type('Ring @len');
  await expect(menu(page)).toBeHidden();
  await expect(page.getByLabel('Add a task')).toHaveValue('Ring @len');
  await page.keyboard.press('Escape');
  await page.goto(`${app.url}/notes/${note.id}`);
  const text = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(text.locator('.page-link-words')).toHaveText('Lena Fischer');
  await expect(text.locator('.page-link-kind')).toBeHidden(); // the face is gone, the name stays
  await text.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Then @le');
  await expect(page.getByRole('listbox', { name: 'Link to' })).toBeHidden();

  // Back on: everything is as it was.
  await page.goto(`${app.url}/settings`);
  await row.getByRole('button', { name: 'On' }).click();
  await expect(row.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('7');
  await expect(page.locator('.task-row .task-words .mention-chip')).toHaveText('LFLena Fischer');
});

test('the journal’s @ menu still works with People in depth on', async ({ page, app }) => {
  await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await newEntry(page, app);
  await page.keyboard.type('Met @len');
  await expect(page.getByRole('listbox', { name: 'Link to' }).getByRole('option').first()).toContainText('Lena Fischer');
});
