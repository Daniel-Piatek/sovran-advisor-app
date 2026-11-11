// From mail to action, with your assistant (advanced/mail/11). Google and Gmail are stood in for; the assistant is tests/fake-claude.js.
import { test, expect } from './fixtures.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';

const post = (app, url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const rows = (page) => page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');
const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);

async function setUp(app, { send = false } = {}) {
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  const j = (url, method, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  await j('/api/google/client', 'PUT', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await follow(await j('/api/google/connect', 'POST', {}));
  const [account] = (await fetch(`${app.url}/api/google`).then((r) => r.json())).accounts;
  await follow(await j(`/api/google/accounts/${account.id}`, 'PATCH', { permission: 'mail.read', on: true }));
  if (send) await follow(await j(`/api/google/accounts/${account.id}`, 'PATCH', { permission: 'mail.send', on: true }));
  await post(app, '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  await post(app, '/api/people', { name: 'Jonas Weber', emails: 'jonas@hafenkante.example' });
  const text = makeMailbox({ filler: 0 }).text.replaceAll('demo@example.com', 'work@mypractice.com');
  expect((await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'work@mypractice.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'w.mbox' }, body: Buffer.from(text) })).status).toBe(200);
}

async function ask(page, app, words) {
  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(words);
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
}

test('t on the invoice opens the task pop-up with the subject, the sender and the mail linked; Add task makes it, due in two weeks from Money; the task links back', async ({ page, app }) => {
  await setUp(app);
  await page.goto(`${app.url}/mail?split=money`);
  await rows(page).first().click();
  await expect(page.locator('.mail-reader-subject')).toHaveText('Invoice 2026-114');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('t');
  const modal = page.getByRole('dialog', { name: 'New task' });
  await expect(modal.getByLabel('The task’s words')).toHaveValue('Invoice 2026-114'); // not typed over by the t itself
  await expect(modal.getByLabel('Details')).toHaveValue(/^From .+@/);
  await expect(modal.getByLabel('Date')).not.toHaveValue('');
  await expect(modal.locator('.task-mail-link')).toContainText('From the mail “Invoice 2026-114”');
  await page.keyboard.press('Escape'); // Escape makes nothing
  await expect(modal).toBeHidden();
  await expect(page.locator('.mail-tasks li')).toHaveCount(0);

  await page.getByRole('button', { name: 'Task', exact: true }).click(); // the Task button beside the trash
  await modal.getByLabel('Details').fill('Pay it before the 20th.');
  await modal.getByRole('button', { name: 'Add task' }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.mail-tasks li')).toContainText('Task: Invoice 2026-114');
  await expect(page.locator('.mail-tasks li')).toContainText('due ');
  await expect(page.locator('.mail-undo')).toContainText('Task made');
  const made = (await fetch(`${app.url}/api/tasks`).then((r) => r.json())).find((t) => t.text === 'Invoice 2026-114');
  expect(made.details).toBe('Pay it before the 20th.');
  expect(made.mail_thread_id).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto(`${app.url}/tasks?view=all`);
  await page.getByText('Invoice 2026-114').first().click();
  const opened = page.getByRole('dialog', { name: 'Task' });
  await expect(opened.locator('.task-mail-link')).toBeVisible();
  await page.keyboard.press('Escape');
  const chip = page.locator('.mail-chip').first();
  await expect(chip).toHaveText(/Mail/);
  await chip.click();
  await expect(page).toHaveURL(/\/mail\?thread=/);
  await expect(page.locator('.mail-reader-subject')).toHaveText('Invoice 2026-114');
});

test('selecting the title with the mouse and letting go beside the pop-up keeps it open; the letters typed after stay in the title and never act on the mail', async ({ page, app }) => {
  await setUp(app);
  await page.goto(`${app.url}/mail?split=money`);
  await rows(page).first().click();
  await expect(page.locator('.mail-reader-subject')).toHaveText('Invoice 2026-114');
  const before = await rows(page).count();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('t');
  const modal = page.getByRole('dialog', { name: 'New task' });
  const title = modal.getByLabel('The task’s words');
  await expect(title).toHaveValue('Invoice 2026-114');
  // Drag across the title to select it, and let go of the button beside the pop-up, as a hand does.
  const box = await title.boundingBox();
  const frame = await modal.boundingBox();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(Math.max(2, frame.x - 30), box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(modal).toBeVisible(); // still open: a drag that ends outside is not a click beside it
  await title.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Pay the bill, decide'); // e, d, t, r, y, n: Mail's keys, typed in the title
  await expect(title).toHaveValue('Pay the bill, decide');
  await expect(rows(page)).toHaveCount(before); // the conversation is still there
  await modal.getByRole('button', { name: 'Add task' }).click();
  await expect(modal).toBeHidden();
  expect((await fetch(`${app.url}/api/tasks`).then((r) => r.json())).some((t) => t.text === 'Pay the bill, decide')).toBe(true);
  await expect(page.locator('.mail-reader-subject')).toHaveText('Invoice 2026-114');
});

test('a task cannot be linked to a conversation that is not there', async ({ app }) => {
  const res = await fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x', mail_thread_id: '00000000-0000-0000-0000-000000000000' }) });
  expect(res.status).toBe(400);
});

test('Cmd K lists Make a task of it with its key, and the ? panel has the row', async ({ page, app }) => {
  await setUp(app);
  await page.goto(`${app.url}/mail?split=important`);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('option', { name: /Make a task of it/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.locator('.mail-times-table tr[data-key="task"]')).toHaveCount(1);
});

test('Settings says what your assistant may do with your mail, and that it cannot be changed', async ({ page, app }) => {
  await setUp(app);
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Your assistant and mail' });
  await expect(part.locator('li[data-rule]')).toHaveText([/already in the conversation/, /never attaches a file/, /at most 10 mails a day/, /never sends by itself/]);
  await expect(part).toContainText('Drafted today: 0 of 10.');
  await expect(part.getByRole('button')).toHaveCount(0);
});

test('a draft is a card: it waits for Send; a stranger is refused; Send gives ten seconds, Undo takes it back, nothing goes', async ({ page, app }) => {
  await setUp(app, { send: true });
  await ask(page, app, 'Draft a reply to the mail about Onboarding: Thursday works for me');
  const card = page.locator('.action-card[data-kind="mail_send"]');
  await expect(card).toHaveAttribute('data-state', 'proposed');
  await expect(card).toContainText('Send a mail to lena@nordlicht.example: “Re: Onboarding call on Thursday?”');
  await expect(card).toContainText('Thursday works for me');
  expect(app.gmail.outgoing.length).toBe(0);

  await ask(page, app, 'Draft a reply to the mail about Onboarding: Hello. to stranger@elsewhere.example');
  await expect(bubbles(page, 'assistant').last()).toContainText('The app refused the draft.');
  await expect(page.locator('.action-card[data-kind="mail_send"]')).toHaveCount(0); // a new chat: the refused one made no card

  await page.goto(`${app.url}/assistant`);
  await page.getByRole('navigation', { name: 'Your chats' }).getByRole('link', { name: /Draft a reply to the mail about Onboarding: Thursday/ }).click();
  const again = page.locator('.action-card[data-kind="mail_send"]');
  await again.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(again).toHaveAttribute('data-state', 'applied');
  await expect(again).toContainText('ten seconds to undo');
  const [row] = await fetch(`${app.url}/api/mail/sends`).then((r) => r.json());
  expect([row.state, row.body]).toEqual(['waiting', 'Thursday works for me']);
  await again.getByRole('button', { name: 'Undo' }).click();
  await expect(again).toHaveAttribute('data-state', 'undone');
  expect((await fetch(`${app.url}/api/mail/sends`).then((r) => r.json()))[0].state).toBe('undone');
  expect(app.gmail.outgoing.length).toBe(0);
});

test('Edit opens the draft in the composer, to change and send; Dismiss leaves nothing', async ({ page, app }) => {
  test.setTimeout(60_000);
  await setUp(app, { send: true });
  await ask(page, app, 'Draft a reply to the mail about Onboarding: Thursday works for me');
  const card = page.locator('.action-card[data-kind="mail_send"]');
  const draftId = new URL(await card.getByRole('link', { name: 'Edit' }).getAttribute('href'), app.url).searchParams.get('draft');
  await card.getByRole('link', { name: 'Edit' }).click();
  const form = page.getByRole('form', { name: 'Write a mail' });
  await expect(form.getByLabel('Your answer')).toHaveValue('Thursday works for me');
  await expect(form.getByLabel('To')).toHaveValue('lena@nordlicht.example');
  await form.getByLabel('Your answer').fill('Thursday works for me, see you at 10');
  await form.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.mail-sending')).toHaveText('Sent.', { timeout: 25_000 });
  expect(app.gmail.outgoing.length).toBe(1);
  const [row] = await fetch(`${app.url}/api/mail/sends`).then((r) => r.json());
  expect(row.body).toBe('Thursday works for me, see you at 10');
  // the card is answered by the send: it cannot be sent a second time
  expect((await fetch(`${app.url}/api/mail/drafts/${draftId}`)).status).toBe(404);

  await ask(page, app, 'Draft a reply to the mail about Brief: Please send the brief.');
  const second = page.locator('.action-card[data-kind="mail_send"]');
  await second.getByRole('button', { name: 'Dismiss' }).click();
  await expect(second).toHaveAttribute('data-state', 'dismissed');
  expect((await fetch(`${app.url}/api/mail/sends`).then((r) => r.json())).length).toBe(1);
});

test('make a task of a mail by asking: it waits on a card as add a task does, and it links back', async ({ page, app }) => {
  await setUp(app);
  await ask(page, app, 'Make a task of the mail about Invoice');
  const card = page.locator('.action-card[data-kind="add_task"]');
  await expect(card).toHaveAttribute('data-state', 'proposed');
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toHaveAttribute('data-state', 'applied');
  const tasks = await fetch(`${app.url}/api/tasks`).then((r) => r.json());
  const list = Array.isArray(tasks) ? tasks : tasks.tasks;
  expect(list.map((t) => [t.text, Boolean(t.mail_thread_id)])).toContainEqual(['Invoice 2026-114', true]);
});
