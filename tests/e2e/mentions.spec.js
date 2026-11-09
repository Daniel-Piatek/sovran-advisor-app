import { test, expect, newEntry } from './fixtures.js';

const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const menu = (page) => page.getByRole('listbox', { name: 'Link to' });

test('@ and a name in today\'s journal: the entry is listed on that person\'s page', async ({ page, app }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await newEntry(page, app);
  await page.keyboard.type('Call with @len');
  await expect(menu(page).getByRole('option').first()).toContainText('Lena Fischer');
  await expect(menu(page).getByRole('option').first()).toContainText('person');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' about March.');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true }).locator('.page-link .page-link-person')).toHaveText('LF');
  await expect(page.getByRole('status')).toHaveText('Saved');

  await page.goto(`${app.url}/people/${lena.id}`);
  const mentioned = page.getByRole('region', { name: 'Mentioned in' });
  await expect(mentioned.getByRole('heading')).toHaveText('Mentioned in · 1');
  await expect(mentioned.locator('.linked-from-context')).toHaveText('Call with Lena Fischer about March.');
  await mentioned.locator('.linked-from-row').click();
  await expect(page).toHaveURL(/\/journal\/entries\//);
  // ...and the name opens the person.
  await page.getByRole('textbox', { name: 'Text', exact: true }).locator('.page-link').click();
  await expect(page).toHaveURL(`${app.url}/people/${lena.id}`);
  const [entry] = await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json();
  expect(entry.preview).toBe(`Call with [Lena Fischer](/people/${lena.id}) about March.`);
});

test('@ can add a new person on the spot, and @@ finds or adds a company', async ({ page, app }) => {
  await send(app, 'POST', '/api/companies', { name: 'Nordlicht Studio' });
  const note = await app.createNote({ title: 'Pilot' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByRole('textbox', { name: 'Text', exact: true }).click();
  await page.keyboard.type('Ask @Jonas Berg');
  await expect(menu(page).getByRole('option').last()).toHaveText(/New person “Jonas Berg”/);
  await page.keyboard.press('Enter');
  await page.keyboard.type(' at @@nord');
  await expect(menu(page).getByRole('option').first()).toContainText('Nordlicht Studio');
  await expect(menu(page).getByRole('option').first()).toContainText('company');
  await page.keyboard.press('Enter');
  const text = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(text.locator('.page-link-person')).toHaveText('JB');
  await expect(text.locator('.page-link-company')).toHaveText('N');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const people = await (await fetch(`${app.url}/api/people`)).json();
  expect(people.map((p) => p.name)).toEqual(['Jonas Berg']);
});

test('an email address does not open the mention list', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Contact' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByRole('textbox', { name: 'Text', exact: true }).click();
  await page.keyboard.type('Write to lena@example.com');
  await expect(menu(page)).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveText('Write to lena@example.com');
});

test('[[ lists people and companies too, with the notes', async ({ page, app }) => {
  await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await app.createNote({ title: 'Lena onboarding' });
  const note = await app.createNote({ title: 'Week' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByRole('textbox', { name: 'Text', exact: true }).click();
  await page.keyboard.type('[[lena');
  await expect(menu(page).locator('.slash-menu-label')).toHaveText(['Lena Fischer', 'Lena onboarding', 'New note “lena”']);
});

test('a company lists its people and what mentions it', async ({ page, app }) => {
  const studio = await send(app, 'POST', '/api/companies', { name: 'Nordlicht Studio' });
  await send(app, 'POST', '/api/people', { name: 'Lena Fischer', company_id: studio.id });
  await app.createNote({ title: 'Proposal', body: `A proposal for [Nordlicht Studio](/companies/${studio.id}).` });
  await page.goto(`${app.url}/companies/${studio.id}`);
  await expect(page.locator('.person-row-name')).toHaveText(['Lena Fischer']);
  await expect(page.getByRole('region', { name: 'Mentioned in' }).locator('.linked-from-source')).toHaveText(['▭Proposal']);
});

test('typing on while a new person is being made loses nothing', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Slow' });
  await page.goto(`${app.url}/notes/${note.id}`);
  // Make adding a person slow, so the typing happens while it is under way.
  await page.route('**/api/people', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.getByRole('textbox', { name: 'Text', exact: true }).click();
  await page.keyboard.type('Ask @Maria Z');
  await expect(menu(page).getByRole('option').last()).toHaveText(/New person “Maria Z”/);
  await page.keyboard.press('Enter');
  await page.keyboard.type(' today');
  const text = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(text.locator('.page-link')).toContainText('Maria Z');
  await expect(text).toHaveText('Ask MZMaria Z today');
});
