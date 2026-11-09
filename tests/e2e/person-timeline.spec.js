import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const rows = (page) => page.locator('.timeline-row');

async function seed(app) {
  const nord = await send(app, 'POST', '/api/companies', { name: 'Nordlicht Studio' });
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer', company_id: nord.id, role: 'Producer' });
  const jonas = await send(app, 'POST', '/api/people', { name: 'Jonas Berg' });
  const note = await app.createNote({ title: 'Onboarding call', body: `Rang [Lena Fischer](/people/${lena.id}) today.` });
  await send(app, 'POST', '/api/entries', { body: `Coffee with [Lena Fischer](/people/${lena.id}).` });
  await app.createNote({ title: 'Jonas only', body: `Ask [Jonas Berg](/people/${jonas.id}).` });
  await app.createNote({ title: 'Unrelated', body: 'Nothing.' });
  const task = await send(app, 'POST', '/api/tasks', { text: 'Send Lena Fischer the intake form', mentions: [{ kind: 'person', id: lena.id }] });
  await send(app, 'PATCH', `/api/tasks/${task.id}`, { done: true });
  return { nord, lena, jonas, note };
}

test('a Timeline tab on a person: only their rows, in the same look, and every one is a row of the big Timeline', async ({ page, app }) => {
  const { lena, note } = await seed(app);
  await page.goto(`${app.url}/people/${lena.id}`);
  const tabs = page.getByRole('tablist', { name: 'Page or Timeline' });
  await expect(tabs.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Notes', level: 2 })).toBeVisible(); // the page as it was
  await expect(rows(page)).toHaveCount(0);

  await tabs.getByRole('tab', { name: 'Timeline' }).click();
  await expect(tabs.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Notes', level: 2 })).toBeHidden();
  await expect(rows(page).locator('.timeline-text')).toHaveText(['Send Lena Fischer the intake form', 'Coffee with Lena Fischer.', 'Onboarding call']);
  await expect(rows(page).locator('.timeline-where')).toHaveText(['Task done', 'Journal', 'Note']);
  await expect(page.getByRole('group', { name: 'Kinds' }).getByRole('button')).toHaveText(['Notes', 'Journal', 'Tasks', 'Logged']); // an event or a capture has no link to follow
  await expect(page).toHaveURL(/\?tab=timeline$/);
  await expect(page.getByRole('separator', { name: 'Now' })).toHaveCount(0); // events are not here, so nothing is ahead

  // Narrowing and searching work inside it; a row opens where it lives.
  await page.getByRole('group', { name: 'Kinds' }).getByRole('button', { name: 'Tasks' }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByLabel('Search this Timeline').fill('onboarding');
  await expect(rows(page).locator('.timeline-text')).toHaveText(['Onboarding call']);
  await rows(page).click();
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);

  // The same rows are in the big Timeline.
  await page.goto(`${app.url}/timeline`);
  await expect(rows(page)).toHaveCount(5);
  for (const text of ['Send Lena Fischer the intake form', 'Coffee with Lena Fischer.', 'Onboarding call', 'Jonas only', 'Unrelated']) {
    await expect(rows(page).filter({ hasText: text })).toHaveCount(1);
  }
});

test('a company’s Timeline has its people’s rows too, each marked with the person', async ({ page, app }) => {
  const { nord, lena } = await seed(app);
  await app.createNote({ title: 'About the studio', body: `On [Nordlicht Studio](/companies/${nord.id}).` });
  await page.goto(`${app.url}/companies/${nord.id}?tab=timeline`); // the address opens the tab
  await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).locator('.timeline-text')).toHaveText([
    'About the studio', 'Send Lena Fischer the intake form · Lena Fischer', 'Coffee with Lena Fischer. · Lena Fischer', 'Onboarding call · Lena Fischer',
  ]);
  await expect(page.locator('.timeline-via')).toHaveCount(3);
  await expect(rows(page).filter({ hasText: 'Jonas only' })).toHaveCount(0);
  // Back to the page: still there as it was, and the person's own tab has no marks.
  await page.getByRole('tab', { name: 'Page' }).click();
  await expect(page.getByRole('heading', { name: 'People here' })).toBeVisible();
  await page.goto(`${app.url}/people/${lena.id}?tab=timeline`);
  await expect(page.locator('.timeline-via')).toHaveCount(0);
});

test('a person with nothing yet says so, and switching People in depth off takes the tab away', async ({ page, app }) => {
  const lonely = await send(app, 'POST', '/api/people', { name: 'Marta Kowalska' });
  await page.goto(`${app.url}/people/${lonely.id}`);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByText('Nothing yet. Log what happened above, or link a note, a journal entry or a task to them.')).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Now' })).toHaveCount(0);

  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' }).click();
  await page.goto(`${app.url}/people/${lonely.id}?tab=timeline`);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Notes', level: 2 })).toBeVisible(); // the page as it was
});
