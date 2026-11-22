// Tags (module tags): one list of tags for notes, journal entries, people, companies, tasks and the Inbox.
import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

// Tags is off in a new install (starter: false): the first test shows that, the rest switch it on first.
test('off in a new install: no tag row, no Tags button, no Settings › Tags', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Venues', body: 'For the #retreat' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(page.locator('.note-info')).toBeVisible();
  await expect(page.locator('.tag-row')).toBeHidden();
  await page.goto(`${app.url}/settings`);
  await expect(page.locator('section[aria-label="Tags"]')).toHaveCount(0);
});

test.describe('switched on', () => {
  test.beforeEach(async ({ app }) => { await send(app, 'PATCH', '/api/modules', { id: 'tags', on: true }); });

  test('a note gets a tag from + Tag and from #word; the Tags button narrows the list', async ({ page, app }) => {
    const venues = await app.createNote({ title: 'Venues', body: 'For the #retreat' });
    await app.createNote({ title: 'Shopping', body: 'Bread' });
    await page.goto(`${app.url}/notes/${venues.id}`);
    const row = page.locator('.tag-row');
    await expect(row.locator('.tag-chip')).toHaveText(['retreat']);
    await row.getByRole('button', { name: 'Tag' }).click();
    await page.getByLabel('Find or make a tag').fill('Workshop');
    await page.getByRole('option', { name: /Make tag “Workshop”/ }).click();
    await expect(row.locator('.tag-chip')).toHaveText(['retreat', 'Workshop']);

    await page.goto(`${app.url}/`);
    await expect(page.locator('.note-card')).toHaveCount(2);
    await page.locator('.tag-filter-button').click();
    await page.getByLabel('Find a tag').fill('retr');
    await page.keyboard.press('Enter');
    await expect(page.locator('.note-card')).toHaveCount(1);
    await expect(page).toHaveURL(/\?tags=[0-9a-f-]{36}/);
  });

  test('a tag’s page shows each kind with its count, newest first, and Open all goes to that kind’s screen', async ({ page, app }) => {
    for (const n of [1, 2, 3]) await app.createNote({ title: `Note ${n}`, body: '#retreat' });
    await send(app, 'POST', '/api/entries', { body: 'Felt the #retreat idea land' });
    const { tags } = await send(app, 'GET', '/api/tags');
    await page.goto(`${app.url}/tags`);
    await page.locator('.tags-index-row', { hasText: 'retreat' }).click();
    await expect(page.locator('.tag-page-count')).toHaveText('4 items');
    const notes = page.locator('.tag-page-kind', { has: page.locator('.tag-page-kind-title', { hasText: 'Notes' }) });
    await expect(notes.locator('.tagged-row')).toHaveCount(2);
    await notes.getByRole('link', { name: /Open all 3/ }).click();
    await expect(page).toHaveURL(new RegExp(`/\\?tags=${tags[0].id}$`));
    await expect(page.locator('.note-card')).toHaveCount(3);
  });

  test('your assistant offers tags on a capture; nothing goes on until you tap one', async ({ page, app }) => {
    await app.createNote({ title: 'Venues', body: 'For the #retreat' });
    const capture = await send(app, 'POST', '/api/captures', { body: 'Book the hall for the retreat suggest-tag:venues' });
    await page.goto(`${app.url}/inbox?c=${capture.id}`);
    const offer = page.locator('.suggestion-tags');
    await expect(offer.locator('.tag-offer')).toHaveText(['retreat', 'venuesnew']);
    await expect(page.locator('.tag-row .tag-chip')).toHaveCount(0);
    await offer.getByRole('button', { name: /venues/ }).click();
    await expect(page.locator('.tag-row .tag-chip')).toHaveText(['venues']);
    await expect(offer.locator('.tag-offer')).toHaveText(['retreat']);
  });

  test('Settings › Tags: a group of any size, and removing a tag can be undone', async ({ page, app }) => {
    await app.createNote({ title: 'Venues', body: 'For the #retreat' });
    await page.goto(`${app.url}/settings`);
    const part = page.locator('section[aria-label="Tags"]');
    await part.getByLabel('New group’s name').fill('Projects');
    await part.getByRole('button', { name: 'Add group' }).click();
    await expect(part.locator('[data-group-id]')).toHaveCount(1);
    await part.locator('[data-fold="tags-list"] summary').click();
    await part.getByLabel('Group of retreat').selectOption({ label: 'Projects' });
    await expect(part.locator('[data-group-id] .tag-settings-count')).toHaveText('1 tag');
    await part.getByRole('button', { name: 'Remove the tag retreat' }).click();
    await expect(part.locator('[data-tag-id]')).toHaveCount(0);
    await part.getByRole('button', { name: 'Undo' }).click();
    await expect(part.locator('[data-tag-id]')).toHaveCount(1);
  });
});
