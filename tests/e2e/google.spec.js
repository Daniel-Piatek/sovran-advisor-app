// Google (advanced/mail/1): Settings › Modules has a Mail row; Settings › Google takes the owner's own
// client, signs an account in, and gives each permission a switch that asks Google only when it is
// switched on. Google and the key store are stood in for (tests/fake-google.js): no real Google, no real client.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, SCOPES } from '../fake-google.js';

const google = (page) => page.getByRole('region', { name: 'Google', exact: true });
const account = (page) => google(page).locator('.google-account');

async function signedIn(page, app) {
  await page.goto(`${app.url}/settings`);
  await google(page).getByLabel('Google client ID').fill(FAKE_CLIENT_ID);
  await google(page).getByLabel('Google client secret').fill(FAKE_CLIENT_SECRET);
  await google(page).getByRole('button', { name: 'Save client' }).click();
  await google(page).getByRole('button', { name: 'Add a Google account' }).click();
  await expect(account(page)).toContainText('work@mypractice.com');
}

test('Mail has its row in Modules, switched on, and Google follows it: it stays while Google Calendar is on, and goes when both are off', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  const row = page.locator('[data-module="mail"]');
  const calendarRow = page.locator('[data-module="calendar-google"]');
  await expect(row).toContainText('Mail');
  await expect(row.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(google(page)).toBeVisible();

  // Mail off: the sign-in is the shared piece and stays for Google Calendar; the Mail limits go.
  await row.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(google(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your assistant and mail' })).toHaveCount(0);
  // Both off: it goes.
  await calendarRow.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(google(page)).toHaveCount(0);
  await row.getByRole('button', { name: 'On', exact: true }).click();
  await expect(google(page)).toBeVisible();
});

test('the client is pasted once, in masked fields that are not password fields, and the secret is never shown again', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  const secret = google(page).getByLabel('Google client secret');
  await expect(secret).toHaveAttribute('type', 'text');
  await expect(secret).toHaveCSS('-webkit-text-security', 'disc');
  await google(page).getByLabel('Google client ID').fill(FAKE_CLIENT_ID);
  await secret.fill(FAKE_CLIENT_SECRET);
  await google(page).getByRole('button', { name: 'Save client' }).click();
  await expect(google(page)).toContainText(FAKE_CLIENT_ID);
  await expect(google(page)).not.toContainText(FAKE_CLIENT_SECRET);
  await expect(secret).toHaveCount(0);
  expect(await page.content()).not.toContain(FAKE_CLIENT_SECRET);
  await google(page).getByRole('button', { name: 'Remove client' }).click();
  await expect(google(page).getByLabel('Google client secret')).toBeVisible();
});

test('sign in, then switch Read your mail on: Google is asked for that one permission, the account shows its health', async ({ page, app }) => {
  await signedIn(page, app);
  await expect(page).toHaveURL(`${app.url}/settings`);
  await expect(google(page)).toContainText('Signed in with Google.');
  await expect(account(page).locator('.google-health')).toHaveText('Connected · last checked just now');
  const read = account(page).locator('[data-permission="mail.read"]');
  const send = account(page).locator('[data-permission="mail.send"]');
  await expect(read.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await expect(send.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await expect(read).toContainText('asks Google, for this permission only');

  await read.getByRole('button', { name: 'On' }).click(); // goes to Google, and comes back
  await expect(read.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await expect(send.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  expect(app.google.seen.filter((c) => c.path === '/auth').map((c) => c.params.scope.split(' ').slice(2))).toEqual([[], [SCOPES.read]]);

  // Off and on: the app's own switch, Google is not asked again.
  await read.getByRole('button', { name: 'Off' }).click();
  await expect(read.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await read.getByRole('button', { name: 'On' }).click();
  await expect(read.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  expect(app.google.seen.filter((c) => c.path === '/auth')).toHaveLength(2);

  // Send mail as you asks for the send permission only; read stays on.
  await send.getByRole('button', { name: 'On' }).click();
  await expect(send.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await expect(read.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  expect(app.google.seen.filter((c) => c.path === '/auth').map((c) => c.params.scope.split(' ').slice(2))).toEqual([[], [SCOPES.read], [SCOPES.send]]);
  await expect(google(page).getByRole('list', { name: 'Google activity' })).toContainText('work@mypractice.com allowed “Read your mail”');
});

test('the tokens are in the key store and in neither the data folder nor the page', async ({ page, app }) => {
  await signedIn(page, app);
  const secrets = [...app.google.secrets.refresh, ...app.google.secrets.access, FAKE_CLIENT_SECRET];
  const filesIn = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).isFile());
  for (const file of filesIn(app.dataDir)) for (const secret of secrets) expect(fs.readFileSync(file).includes(secret), `${path.basename(file)} holds a secret`).toBe(false);
  expect(filesIn(app.keyStoreDir).some((f) => fs.readFileSync(f, 'utf8').includes(app.google.secrets.refresh[0]))).toBe(true);
  const text = await page.content();
  for (const secret of secrets) expect(text).not.toContain(secret);
});

test('when Google no longer lets the app in, the account says so and one button signs in again', async ({ page, app }) => {
  await signedIn(page, app);
  for (const token of app.google.secrets.refresh) app.google.revoked.add(token); // removed in the Google account
  await account(page).getByRole('button', { name: 'Check now' }).click();
  await expect(account(page).locator('.google-health')).toHaveText('Google no longer lets the app in.');
  await expect(account(page)).toHaveAttribute('data-health', 'needs_signin');

  await account(page).getByRole('button', { name: 'Sign in again' }).click();
  await expect(account(page).locator('.google-health')).toHaveText('Connected · last checked just now');
  await expect(account(page)).toHaveCount(1);
});

test('disconnecting tells Google and takes the account away', async ({ page, app }) => {
  await signedIn(page, app);
  const refresh = app.google.secrets.refresh[0];
  await account(page).getByRole('button', { name: 'Disconnect work@mypractice.com' }).click();
  await expect(account(page)).toHaveCount(0);
  await expect(google(page)).toContainText('No Google account yet.');
  expect(app.google.revoked.has(refresh)).toBe(true);
});

test('Google says no: the page says so and no account appears', async ({ page, app }) => {
  app.google.deny = true;
  await page.goto(`${app.url}/settings`);
  await google(page).getByLabel('Google client ID').fill(FAKE_CLIENT_ID);
  await google(page).getByLabel('Google client secret').fill(FAKE_CLIENT_SECRET);
  await google(page).getByRole('button', { name: 'Save client' }).click();
  await google(page).getByRole('button', { name: 'Add a Google account' }).click();
  await expect(google(page).getByRole('alert')).toContainText('not allowed to sign you in');
  await expect(google(page)).toContainText('No Google account yet.');
});
