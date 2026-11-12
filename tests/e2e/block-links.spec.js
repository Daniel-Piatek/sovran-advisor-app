// Block links and embeds (advanced/writing/2): (( finds a bullet of any note; alone in its line the link shows the passage, live.
import { test, expect, tapAtEnd } from './fixtures.js';

const PRICING = '* Package: 3 days for 4800 EUR\n  * Prep and a follow-up call\n* Day rate: 1700 EUR';
const text = (page) => page.getByLabel('Text');
const bulletOf = async (app, q) => (await fetch(`${app.url}/api/bullets?q=${encodeURIComponent(q)}`).then((r) => r.json()))[0];
const noteOf = (app, id) => fetch(`${app.url}/api/notes/${id}`).then((r) => r.json());

async function twoNotes(app) {
  const pricing = await app.createNote({ title: 'Pricing thoughts', body: PRICING });
  const pack = await bulletOf(app, 'package');
  const proposal = await app.createNote({ title: 'Proposal outline', body: '* Price it as a fixed package\n  * Followed by the schedule' });
  return { pricing, pack, proposal };
}

test('(( and some words of a bullet: Enter puts it in as its words, saved as ((id)); the other note lists this one in Linked from and says Used in 1 place', async ({ page, app }) => {
  const { pricing, pack, proposal } = await twoNotes(app);
  await page.goto(`${app.url}/notes/${proposal.id}`);
  await text(page).getByText('Followed by the schedule').click();
  await tapAtEnd(text(page));
  await page.keyboard.press('Enter');
  await page.keyboard.type('Priced as in ((Package: 3');
  const menu = page.getByRole('listbox', { name: 'Link to' });
  await expect(menu.getByRole('option')).toHaveText([/Package: 3 days for 4800 EUR\s*Pricing thoughts/]);
  await page.keyboard.press('Enter');
  await expect(text(page).locator('.block-ref-link')).toHaveText('Package: 3 days for 4800 EUR');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, proposal.id)).body).toContain(`((${pack.id}))`);

  await page.goto(`${app.url}/notes/${pricing.id}`);
  await expect(page.locator('.used-in')).toHaveText('Used in 1 place');
  await page.locator('.used-in').click();
  await expect(page.getByRole('list', { name: 'Used in' })).toContainText('Proposal outline');
  await expect(page.getByRole('region', { name: 'Linked from' }).or(page.locator('.linked-from'))).toContainText('Proposal outline');
});

test('alone in its bullet the link shows the passage with what is under it, framed with its note; a changed word follows; Removed passage when it is gone', async ({ page, app }) => {
  const { pricing, pack, proposal } = await twoNotes(app);
  await app.updateNote(proposal.id, { body: `* Price it as a fixed package\n  * ((${pack.id}))` });
  await page.goto(`${app.url}/notes/${proposal.id}`);
  const embed = text(page).locator('.block-embed');
  await expect(embed).toContainText('Package: 3 days for 4800 EUR');
  await expect(embed).toContainText('Prep and a follow-up call');
  await expect(embed).toContainText('From Pricing thoughts');

  await app.updateNote(pricing.id, { body: PRICING.replace('4800', '5200') }); // changed where it lives
  await page.reload();
  await expect(text(page).locator('.block-embed')).toContainText('Package: 3 days for 5200 EUR');
  expect((await noteOf(app, proposal.id)).body).toBe(`* Price it as a fixed package\n  * ((${pack.id}))`); // the text holds the address, never a copy

  await app.updateNote(pricing.id, { body: '* Day rate: 1700 EUR' }); // the passage is removed
  await page.reload();
  await expect(text(page).locator('.block-ref')).toHaveText('Removed passage');
});

test('a link in the middle of words is its words, underlined; it opens its note at that bullet, marked', async ({ page, app }) => {
  const { pricing, pack, proposal } = await twoNotes(app);
  await app.updateNote(proposal.id, { body: `Priced as in ((${pack.id})) for now.` });
  await page.goto(`${app.url}/notes/${proposal.id}`);
  await expect(text(page)).toContainText('Priced as in Package: 3 days for 4800 EUR for now.');
  await expect(text(page).locator('.block-embed')).toHaveCount(0);
  await text(page).locator('.block-ref-link').click();
  await expect(page).toHaveURL(new RegExp(`/notes/${pricing.id}\\?bullet=${pack.id}`));
  await expect(text(page).locator('li.is-found')).toContainText('Package: 3 days for 4800 EUR');
});

test('switched off, the address stays as plain text and (( opens nothing', async ({ page, app }) => {
  const { pack, proposal } = await twoNotes(app);
  await app.updateNote(proposal.id, { body: `((${pack.id}))` });
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true'); // saved before the page is left
  await page.goto(`${app.url}/notes/${proposal.id}`);
  await expect(text(page)).toContainText(`((${pack.id}))`);
  await expect(text(page).locator('.block-ref')).toHaveCount(0);
  await tapAtEnd(text(page));
  await page.keyboard.type(' ((x');
  await expect(page.getByRole('listbox', { name: 'Link to' })).toHaveCount(0);
});
