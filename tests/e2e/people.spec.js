import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

test('n adds a person; how you met is still there after closing and opening the app', async ({ page, app }) => {
  await page.goto(`${app.url}/people`);
  await expect(page.getByText('No people yet.')).toBeVisible();
  await page.keyboard.press('n');
  await page.getByLabel('New person’s name').fill('Lena Fischer');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(page.locator('.contact-card .face')).toHaveText('LF');
  await page.getByLabel('How we met').fill('Workshop in Hamburg, 2025');
  await page.getByLabel('Role').fill('Producer');
  await expect(page.getByRole('status')).toHaveText('Saved');

  const url = page.url();
  await page.close();
  const again = await page.context().newPage();
  await again.goto(url);
  await expect(again.getByLabel('How we met')).toHaveValue('Workshop in Hamburg, 2025');
  await expect(again.locator('.contact-sub')).toHaveText('Producer');
});

test('a person can belong to a company, made on the spot; the company lists its people', async ({ page, app }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await page.goto(`${app.url}/people/${lena.id}`);
  await page.getByLabel('Company', { exact: true }).selectOption({ label: 'New company…' });
  await page.getByLabel('New company’s name').fill('Nordlicht Studio');
  await page.keyboard.press('Enter');
  await expect(page.locator('.contact-sub')).toHaveText('Nordlicht Studio');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.locator('.contact-sub').getByRole('link', { name: 'Nordlicht Studio' }).click();
  await expect(page).toHaveURL(/\/companies\//);
  await expect(page.locator('.contact-card .face')).toHaveText('N');
  await expect(page.locator('.person-row-name')).toHaveText(['Lena Fischer']);
});

test('your notes about a person save as you type, with several emails, one per line', async ({ page, app }) => {
  const jonas = await send(app, 'POST', '/api/people', { name: 'Jonas Berg' });
  await page.goto(`${app.url}/people/${jonas.id}`);
  await page.getByLabel('Emails').fill('jonas@a.example\njonas@b.example');
  await page.getByRole('textbox', { name: 'Notes about them' }).click();
  await page.keyboard.type('Knows a room by the **harbour**.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const saved = await (await fetch(`${app.url}/api/people/${jonas.id}`)).json();
  expect([saved.emails, saved.body]).toEqual(['jonas@a.example\njonas@b.example', 'Knows a room by the **harbour**.']);
});

test('the People list: names, roles and companies, search, and the Companies tab', async ({ page, app, isMobile }) => {
  const studio = await send(app, 'POST', '/api/companies', { name: 'Nordlicht Studio' });
  await send(app, 'POST', '/api/people', { name: 'Lena Fischer', role: 'Producer', company_id: studio.id });
  await send(app, 'POST', '/api/people', { name: 'Jonas Berg' });
  await page.goto(app.url);
  const sections = page.getByRole('navigation', { name: 'Sections' });
  if (isMobile) { // on a phone, People is under More
    await sections.getByRole('button', { name: 'More' }).click();
    await sections.getByRole('menuitem', { name: 'People' }).click();
  } else {
    await sections.getByRole('link', { name: 'People' }).click();
  }
  await expect(page.locator('.person-row-name')).toHaveText(['Jonas Berg', 'Lena Fischer']);
  await expect(page.locator('.person-row-sub')).toHaveText(['No company', 'Producer · Nordlicht Studio']);
  await page.getByLabel('Search people').fill('nord');
  await expect(page.locator('.person-row-name')).toHaveText(['Lena Fischer']);
  await page.getByRole('link', { name: 'Companies' }).click();
  await expect(page.locator('.person-row-name')).toHaveText(['Nordlicht Studio']);
  await expect(page.locator('.person-row-sub')).toHaveText(['1 person']);
});

test('deleting a person offers Undo, and Recently deleted can bring them back', async ({ page, app }) => {
  const maria = await send(app, 'POST', '/api/people', { name: 'Maria Z', how_met: 'Book club' });
  await page.goto(`${app.url}/people/${maria.id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(`${app.url}/people`);
  await expect(page.locator('.undo-bar')).toContainText('“Maria Z” deleted.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.person-row-name')).toHaveText(['Maria Z']);

  await fetch(`${app.url}/api/people/${maria.id}`, { method: 'DELETE' });
  await page.goto(`${app.url}/deleted`);
  const row = page.locator('.deleted-row', { hasText: 'Maria Z' });
  await expect(row.locator('.tag')).toHaveText('Person');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(row).toContainText('back in People');
});

test('on a phone the person page fits without spilling sideways', async ({ page, app }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer with a rather long name indeed', emails: 'a-very-long-email-address@example.com' });
  await page.goto(`${app.url}/people/${lena.id}`);
  await expect(page.getByLabel('How we met')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
