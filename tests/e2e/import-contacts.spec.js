import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

test.use({ expectedConsoleErrors: [/status of 400/] }); // one test chooses a file that is not contacts, on purpose

const VCF = [
  'BEGIN:VCARD', 'VERSION:3.0', 'UID:uid-lena', 'FN:Lena Fischer', 'ORG:Elbkontor', 'TITLE:Operations lead', 'EMAIL:lena@elbkontor.de', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'UID:uid-jonas', 'FN:Jonas Weber', 'ORG:Elbkontor', 'EMAIL:jonas@elbkontor.de', 'TEL:+49 40 123', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'UID:uid-marta', 'FN:Marta Kowalska', 'ORG:Nordlicht', 'END:VCARD', '',
].join('\r\n');

const choose = (page, name, content, mimeType = 'text/vcard') => page.getByLabel('Choose a file').setInputFiles({ name, mimeType, buffer: Buffer.from(content) });

test('Import in People: choose a vCard, see what it would do, import; run again and nobody is doubled', async ({ page, app }) => {
  await page.goto(`${app.url}/people`);
  await page.getByRole('button', { name: 'Import' }).click();
  const box = page.getByRole('dialog', { name: 'Import contacts' });
  await expect(box.getByRole('button', { name: 'Import' })).toBeDisabled();
  await choose(page, 'phone.vcf', VCF);
  await expect(box.getByRole('status')).toHaveText('3 contacts read · 3 new · 0 here already · 2 companies to make');
  await expect(box).toContainText('New: Lena Fischer, Jonas Weber, Marta Kowalska');
  expect(await send(app, 'GET', '/api/people')).toEqual([]); // a preview changes nothing
  await box.getByRole('button', { name: 'Import' }).click();
  await expect(box.getByRole('status')).toHaveText('Added 3 people and 2 companies. 0 were here already.');
  await expect(box.getByRole('button', { name: 'Import' })).toBeDisabled();
  await box.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.people-list .person-row').filter({ hasText: 'Lena Fischer' })).toContainText('Operations lead · Elbkontor');
  await expect(page.locator('.people-list .person-row')).toHaveCount(3);

  // Again: nothing to add, and the number of people is the same.
  await page.getByRole('button', { name: 'Import' }).click();
  await choose(page, 'phone.vcf', VCF);
  await expect(page.getByRole('dialog', { name: 'Import contacts' }).getByRole('status')).toHaveText('3 contacts read · 0 new · 3 here already · nothing new to add.');
  await expect(page.getByRole('dialog', { name: 'Import contacts' }).getByRole('button', { name: 'Import' })).toBeDisabled();
  expect((await send(app, 'GET', '/api/people')).length).toBe(3);
  expect((await send(app, 'GET', '/api/companies')).length).toBe(2);
});

test('your edits win: a role you changed stays when the file says something else, and imported people work like any other', async ({ page, app }) => {
  await page.goto(`${app.url}/people`);
  await page.getByRole('button', { name: 'Import' }).click();
  await choose(page, 'phone.vcf', VCF);
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Added 3 people');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  const [lena] = (await send(app, 'GET', '/api/people?q=lena'));
  await send(app, 'PATCH', `/api/people/${lena.id}`, { role: 'Head of operations' });
  const changed = VCF.replace('TITLE:Operations lead', 'TITLE:Operations lead (new title)');
  await page.getByRole('button', { name: 'Import' }).click();
  await choose(page, 'phone.vcf', changed);
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('3 here already');
  expect((await send(app, 'GET', `/api/people/${lena.id}`)).role).toBe('Head of operations');
  await page.keyboard.press('Escape');
  // An imported person has a page, a rhythm, a timeline like anyone.
  await page.goto(`${app.url}/people/${lena.id}`);
  await expect(page.getByRole('button', { name: 'No rhythm' })).toBeVisible();
  await expect(page.getByLabel('Role')).toHaveValue('Head of operations');
  await expect(page.getByLabel('Emails')).toHaveValue('lena@elbkontor.de');
  // Elbkontor was made once, with its two people.
  const [elb] = await send(app, 'GET', '/api/companies?q=elbkontor');
  await page.goto(`${app.url}/companies/${elb.id}`);
  await expect(page.locator('.person-row')).toHaveCount(2);
});

test('a Google CSV is read too; a file that is not contacts says so; with People in depth off there is no Import', async ({ page, app }) => {
  const csv = 'First Name,Last Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Value,Organization Name,Organization Title\nLena,Fischer,Work,lena@elbkontor.de,+49 1,Elbkontor,Lead\n"Berg, Jr.",Jonas,,j@x.de,,,\n';
  await page.goto(`${app.url}/people`);
  await page.getByRole('button', { name: 'Import' }).click();
  await choose(page, 'google.csv', csv, 'text/csv');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('2 contacts read · 2 new · 0 here already · 1 company to make');
  await choose(page, 'notes.csv', 'Foo,Bar\n1,2\n', 'text/csv');
  await expect(page.getByRole('alert').filter({ hasText: 'no name or email column' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' }).click();
  await page.goto(`${app.url}/people`);
  await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0);
});
