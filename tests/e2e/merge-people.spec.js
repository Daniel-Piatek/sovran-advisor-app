import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

async function seed(app) {
  const mara = await send(app, 'POST', '/api/people', { name: 'Mara Kühn', role: 'Producer', emails: 'mara@home.de' });
  const imported = await fetch(`${app.url}/api/import/contacts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'g.csv', text: 'Name,Email,Phone,Company,Title\nMara Kuehn (Nordlicht),mara@nordlicht.de,+49 170 1,Nordlicht,Head of production\nLena Fischer,lena@x.de,,,\n' }),
  }).then((r) => r.json());
  const [other] = (await send(app, 'GET', '/api/people?q=kuehn'));
  const note = await app.createNote({ title: 'Ideas for the autumn workshop', body: `Ask [Mara Kühn](/people/${mara.id}) and [Mara Kuehn](/people/${other.id}).` });
  const note2 = await app.createNote({ title: 'Offer', body: `Send to [Mara Kuehn](/people/${other.id}).` });
  await send(app, 'POST', '/api/interactions', { about: { kind: 'person', id: other.id }, kind: 'message', note: 'Sent the intake form' });
  return { mara, other, imported, note, note2 };
}

test('Possible duplicates: the two Maras are listed; Compare shows her work email on one side and her phone on the other', async ({ page, app }) => {
  const { mara } = await seed(app);
  await page.goto(`${app.url}/people`);
  const section = page.getByRole('region', { name: 'Possible duplicates' });
  await expect(section.getByRole('heading')).toHaveText('Possible duplicates · 1');
  await expect(section.locator('.duplicate-row')).toContainText('Mara Kühn↔MKMara Kuehn (Nordlicht)');
  await expect(section.locator('.duplicate-row')).toContainText('same name');
  await section.getByRole('button', { name: /Compare/ }).click();
  const box = page.getByRole('dialog', { name: 'Compare two entries' });
  await expect(box.locator('.merge-row-head')).toContainText('written by you');
  await expect(box.locator('.merge-row-head')).toContainText('imported');
  await expect(box.locator('[data-row="emails"] .merge-value')).toHaveText(['mara@home.de', 'mara@nordlicht.de']);
  await expect(box.locator('[data-row="emails"]')).toContainText('Both');
  await expect(box.locator('[data-row="phones"] .merge-value').nth(1)).toHaveText('+49 170 1');
  // Defaults: yours first, and where both have something, both.
  await expect(box.getByLabel('Name: Mara Kühn’s')).toBeChecked();
  await expect(box.getByLabel('Role: Mara Kühn’s')).toBeChecked();
  await expect(box.getByLabel('Emails: both')).toBeChecked();
  await expect(box.getByLabel('Phones: Mara Kuehn (Nordlicht)’s')).toBeChecked();
  await expect(box.getByLabel('Company: Mara Kuehn (Nordlicht)’s')).toBeChecked();
  // Pick her work title instead.
  await box.getByLabel('Role: Mara Kuehn (Nordlicht)’s').check();
  await box.getByRole('button', { name: 'Keep one entry' }).click();
  await expect(box.getByRole('status')).toContainText('Merged into Mara Kühn.');
  await box.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('region', { name: 'Possible duplicates' })).toHaveCount(0);
  await expect(page.locator('.people-list').last().locator('.person-row').filter({ hasText: 'Mara' })).toHaveCount(1);

  // One Mara with all of it: four mentions of her (two in the first note, one in each of the others), the message on her timeline.
  await page.goto(`${app.url}/people/${mara.id}`);
  await expect(page.getByLabel('Role')).toHaveValue('Head of production');
  await expect(page.getByLabel('Emails')).toHaveValue('mara@home.de\nmara@nordlicht.de');
  await expect(page.getByLabel('Phones')).toHaveValue('+49 170 1');
  await expect(page.getByRole('region', { name: 'Mentioned in' }).getByRole('heading')).toHaveText('Mentioned in · 3');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.timeline-row').filter({ hasText: 'Sent the intake form' })).toHaveCount(1);
  // The chip in the note now leads to the one Mara.
  const { items } = await send(app, 'GET', '/api/timeline?kinds=note');
  const ideas = items.find((i) => i.text === 'Ideas for the autumn workshop');
  await page.goto(`${app.url}${ideas.href}`);
  const links = page.getByRole('textbox', { name: 'Text', exact: true }).locator('a.page-link');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute('href', `/people/${mara.id}`);
  await expect(links.nth(1)).toHaveAttribute('href', `/people/${mara.id}`);
});

test('Recently deleted shows the merged entry, and Restore undoes the merge: both Maras and their mentions are back', async ({ page, app }) => {
  const { mara, other } = await seed(app);
  await send(app, 'POST', '/api/people/merge', { keep: mara.id, drop: other.id, fields: { role: 'drop' } });
  await page.goto(`${app.url}/deleted`);
  const row = page.locator('.deleted-row').filter({ hasText: 'Mara Kuehn (Nordlicht) (merged into Mara Kühn)' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(row).toContainText('back in People, and the merge undone');
  expect((await send(app, 'GET', '/api/people?q=mara')).length).toBe(2);
  expect((await send(app, 'GET', `/api/people/${mara.id}`)).role).toBe('Producer');
  await page.goto(`${app.url}/people/${other.id}`);
  await expect(page.getByRole('region', { name: 'Mentioned in' }).getByRole('heading')).toHaveText('Mentioned in · 2');
  await page.goto(`${app.url}/people`);
  await expect(page.getByRole('region', { name: 'Possible duplicates' }).getByRole('heading')).toHaveText('Possible duplicates · 1');
});

test('Not the same person hides the pair for good; with People in depth off there is no list', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/people`);
  await page.getByRole('region', { name: 'Possible duplicates' }).getByRole('button', { name: /Compare/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Not the same person' }).click();
  await expect(page.getByRole('region', { name: 'Possible duplicates' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Possible duplicates' })).toHaveCount(0);
  expect(await send(app, 'GET', '/api/people/duplicates')).toEqual([]);
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' }).click();
  await send(app, 'POST', '/api/people', { name: 'Zed Same' });
  await send(app, 'POST', '/api/people', { name: 'Zed Same' });
  await page.goto(`${app.url}/people`);
  await expect(page.getByRole('region', { name: 'Possible duplicates' })).toHaveCount(0);
});
