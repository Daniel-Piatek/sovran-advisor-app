import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const pad = (n) => String(n).padStart(2, '0');
const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };

async function seed(app) {
  const jonas = await send(app, 'POST', '/api/people', { name: 'Jonas Weber', role: 'Client' });
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  const marta = await send(app, 'POST', '/api/people', { name: 'Marta Kowalska' });
  await send(app, 'PATCH', `/api/people/${jonas.id}`, { cadence_days: 7 });
  await send(app, 'PATCH', `/api/people/${lena.id}`, { cadence_days: 21 });
  const call = (person, ago) => send(app, 'POST', '/api/interactions', { about: { kind: 'person', id: person.id }, kind: 'call', note: 'Spoke', when: daysFromNow(-ago) });
  await call(jonas, 9);
  await call(lena, 12);
  return { jonas, lena, marta };
}

test('People opens on Reconnect: the most overdue first, Remind me only for who is due, and it makes a task for tomorrow', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/people`);
  const rows = page.getByRole('region', { name: 'Reconnect' }).locator('.reconnect-row');
  await expect(rows).toHaveCount(2); // Marta has no rhythm
  await expect(rows.nth(0)).toContainText('Jonas Weber');
  await expect(rows.nth(0)).toContainText('2 days overdue');
  await expect(rows.nth(1)).toContainText('Lena Fischer');
  await expect(rows.nth(1)).toContainText('due in 9 days');
  await expect(rows.nth(0).getByRole('button', { name: 'Remind me' })).toBeVisible();
  await expect(rows.nth(1).getByRole('button', { name: 'Remind me' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Everyone' })).toBeVisible(); // the list is still there
  await expect(page.locator('.people-list').last().locator('.person-row')).toHaveCount(3);

  await rows.nth(0).getByRole('button', { name: 'Remind me' }).click();
  await expect(rows.nth(0)).toContainText('Added “Reconnect with Jonas” for tomorrow.');
  await expect(rows.nth(0).getByRole('button', { name: 'Reminded' })).toBeDisabled();
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByRole('tablist', { name: 'Views' })).toBeVisible(); // the keys work once the page is drawn
  await page.keyboard.press('2'); // Upcoming
  await expect(page.locator('.task-row .task-words').filter({ hasText: 'Reconnect with Jonas' })).toHaveCount(1);
  expect((await send(app, 'GET', '/api/tasks'))[0].due).toBe(daysFromNow(1));
});

test('the chip under a name says how long is left; pressing it changes the rhythm; logging a call moves Jonas off overdue', async ({ page, app }) => {
  const { jonas } = await seed(app);
  await page.goto(`${app.url}/people/${jonas.id}`);
  const chip = page.getByRole('button', { name: 'Weekly · 2 days overdue' });
  await expect(chip).toBeVisible();
  await chip.click();
  const choices = page.getByRole('group', { name: 'How often' });
  await expect(choices.getByRole('button')).toHaveText(['Off', 'Weekly', 'Every 2 weeks', 'Every 3 weeks', 'Monthly', 'Quarterly']);
  await expect(choices.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true');
  await choices.getByRole('button', { name: 'Every 2 weeks' }).click();
  await expect(page.getByRole('button', { name: 'Every 2 weeks · due in 5 days' })).toBeVisible();
  expect((await send(app, 'GET', `/api/people/${jonas.id}`)).cadence_days).toBe(14);
  await page.getByRole('button', { name: 'Every 2 weeks · due in 5 days' }).click();
  await page.getByRole('group', { name: 'How often' }).getByRole('button', { name: 'Weekly' }).click();
  await expect(page.getByRole('button', { name: 'Weekly · 2 days overdue' })).toBeVisible();

  // Log a call with him: the chip moves at once, and he is off the overdue part of the list.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByLabel('What happened').fill('Quick call about the draft');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Weekly · due in 7 days' })).toBeVisible();
  await page.goto(`${app.url}/people`);
  const first = page.locator('.reconnect-row').first(); // 7 days left still comes before Lena's 9
  await expect(first).toContainText('Jonas Weber');
  await expect(first).toContainText('due in 7 days');
  await expect(first.getByRole('button', { name: 'Remind me' })).toHaveCount(0); // he is no longer due
});

test('a person with no rhythm has a quiet chip that says so, and the Reconnect list tells how to start', async ({ page, app }) => {
  const marta = await send(app, 'POST', '/api/people', { name: 'Marta Kowalska' });
  await page.goto(`${app.url}/people`);
  await expect(page.getByText('Nobody has a rhythm yet.')).toBeVisible();
  await page.goto(`${app.url}/people/${marta.id}`);
  await page.getByRole('button', { name: 'No rhythm' }).click();
  await page.getByRole('group', { name: 'How often' }).getByRole('button', { name: 'Monthly' }).click();
  await expect(page.getByRole('button', { name: 'Monthly · due today · nothing logged yet' })).toBeVisible();
  await page.goto(`${app.url}/people`);
  await expect(page.locator('.reconnect-row')).toHaveCount(1);
  await expect(page.locator('.reconnect-row')).toContainText('due today');
});

test('with People in depth off there is no chip and no Reconnect list; and the assistant says who to reconnect with', async ({ page, app }) => {
  const { jonas } = await seed(app);
  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Who should I reconnect with?');
  await input.press('Enter');
  const answer = page.locator('.chat-bubble[data-role="assistant"]').last();
  await expect(answer).toHaveAttribute('data-state', 'done');
  await expect(answer.locator('.chat-text')).toContainText('Most overdue first: Jonas Weber (2 days overdue), Lena Fischer (due in 9 days).');

  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true'); // saved before the page is left
  await page.goto(`${app.url}/people`);
  await expect(page.getByRole('region', { name: 'Reconnect' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Everyone' })).toHaveCount(0);
  await page.goto(`${app.url}/people/${jonas.id}`);
  await expect(page.locator('.cadence')).toHaveCount(0);
  expect((await send(app, 'GET', `/api/people/${jonas.id}`)).cadence_days).toBe(7); // kept
});
