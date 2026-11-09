import fs from 'node:fs';
import path from 'node:path';
import { test, expect, newEntry } from './fixtures.js';

const png = fs.readFileSync(new URL('../../public/icons/favicon-48.png', import.meta.url)).toString('base64');

// Drops (or pastes) a file onto an editor, the way the browser does when you drag one in.
async function giveFile(page, target, { name, type, base64, how = 'drop' }) {
  await target.evaluate((el, { name, type, base64, how }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], name, { type }));
    const box = el.getBoundingClientRect();
    el.dispatchEvent(how === 'drop'
      ? new DragEvent('drop', { dataTransfer: data, clientX: box.left + 4, clientY: box.top + 4, bubbles: true, cancelable: true })
      : new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, { name, type, base64, how });
}

// ProseMirror puts a hidden helper image after a picture at the end of a line; it is not a picture.
const pictures = (editor) => editor.locator('img:not(.ProseMirror-separator)');

const filesOnDisk = (app) => (fs.existsSync(path.join(app.dataDir, 'files')) ? fs.readdirSync(path.join(app.dataDir, 'files')) : []);

test('the same picture dropped into two notes: one copy on disk, shown in both', async ({ page, app }) => {
  const first = await app.createNote({ title: 'Workshop ideas', body: 'Sketch:' });
  const second = await app.createNote({ title: 'Journal of sketches' });

  for (const note of [first, second]) {
    await page.goto(`${app.url}/notes/${note.id}`);
    await giveFile(page, page.getByLabel('Text'), { name: 'sketch.png', type: 'image/png', base64: png });
    const picture = pictures(page.getByLabel('Text'));
    await expect(picture).toHaveAttribute('src', /^\/files\/[0-9a-f]{64}$/);
    await expect.poll(() => picture.evaluate((img) => img.complete && img.naturalWidth)).toBe(48);
    await expect(page.getByRole('status')).toHaveText('Saved');
  }

  expect(filesOnDisk(app)).toHaveLength(1);
  const bodies = await Promise.all([first, second].map(async (n) => (await (await fetch(`${app.url}/api/notes/${n.id}`)).json()).body));
  const [src] = bodies[0].match(/\/files\/[0-9a-f]{64}/);
  expect(bodies[1]).toContain(src);
  expect(bodies[0]).toMatch(/^Sketch:!\[sketch\.png\]\(\/files\/[0-9a-f]{64} "sketch\.png"\)$|^!\[sketch\.png\]/);

  // After a reload the picture is still there.
  await page.goto(`${app.url}/notes/${first.id}`);
  await expect.poll(() => pictures(page.getByLabel('Text')).evaluate((img) => img.complete && img.naturalWidth)).toBe(48);
});

test('a pasted file that is not a picture becomes a file card with its name, kind, size and Open', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Plan' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByLabel('Text').click();
  await giveFile(page, page.getByLabel('Text'), {
    name: 'plan.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'), how: 'paste',
  });
  const card = page.getByLabel('Text').locator('.file-card');
  await expect(card.locator('.file-card-name')).toHaveText('plan.pdf');
  await expect(card.locator('.file-card-kind')).toHaveText('PDF');
  await expect(card.locator('.file-card-meta')).toHaveText('PDF · 14 bytes');
  const open = card.getByRole('link', { name: 'Open' });
  await expect(open).toHaveAttribute('href', /^\/files\/[0-9a-f]{64}$/);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const { body } = await (await fetch(`${app.url}/api/notes/${note.id}`)).json();
  expect(body).toMatch(/^\[plan\.pdf\]\(\/files\/[0-9a-f]{64}\)$/);

  await page.reload();
  await expect(page.getByLabel('Text').locator('.file-card-name')).toHaveText('plan.pdf');
  const res = await fetch(app.url + await open.getAttribute('href'));
  expect(res.headers.get('content-type')).toBe('application/pdf');
});

test('a file can go into a new journal entry', async ({ page, app }) => {
  await newEntry(page, app);
  await page.keyboard.type('Today’s sketch ');
  await giveFile(page, page.getByLabel('Text'), { name: 'sketch.png', type: 'image/png', base64: png, how: 'paste' });
  await expect(pictures(page.getByLabel('Text'))).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('Saved');
  const entries = await (await fetch(`${app.url}/api/entries`)).json();
  expect(entries.map((e) => e.preview)).toEqual([expect.stringContaining('/files/')]);
  expect(filesOnDisk(app)).toHaveLength(1);
});

test.describe('a file that is too large', () => {
  test.use({ expectedConsoleErrors: [/413/] });

  test('is refused with a message, and nothing is kept', async ({ page, app }) => {
    const note = await app.createNote({ title: 'Big' });
    await page.goto(`${app.url}/notes/${note.id}`);
    await page.getByLabel('Text').evaluate((el) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(26 * 1024 * 1024)], 'huge.bin', { type: 'application/octet-stream' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    // 26 MB takes a while to send when many tests run at once.
    await expect(page.getByRole('status')).toContainText('“huge.bin” couldn\'t be added', { timeout: 15_000 });
    await expect(page.getByRole('status')).toContainText('25 MB');
    expect(filesOnDisk(app)).toHaveLength(0);
  });
});

test('Open on a file card opens the file in a new tab, and the note stays', async ({ page, app, context }) => {
  const kept = await (await fetch(`${app.url}/api/files`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'plan.pdf' }, body: '%PDF-1.4\n%%EOF',
  })).json();
  const note = await app.createNote({ title: 'Plan', body: `Before\n\n[plan.pdf](${kept.url})\n\nAfter` });
  await page.goto(`${app.url}/notes/${note.id}`);
  // The test browser has no PDF viewer and treats the PDF as a download, so the new tab
  // never shows it: what counts is that a new tab asked for the file.
  const opened = context.waitForEvent('page');
  const asked = context.waitForEvent('request', (request) => request.url() === app.url + kept.url);
  await page.getByLabel('Text').locator('.file-card').getByRole('link', { name: 'Open' }).click();
  const tab = await opened;
  expect((await asked).frame().page()).toBe(tab);
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);
  await tab.close();
});

test.describe('a file that is gone', () => {
  // The browser logs the server's "not found" for the missing file: that one is expected.
  test.use({ expectedConsoleErrors: [/404 \(Not Found\)/] });

  test('its card says so', async ({ page, app }) => {
    const note = await app.createNote({ title: 'Gone', body: `[old.pdf](/files/${'0'.repeat(64)})` });
    await page.goto(`${app.url}/notes/${note.id}`);
    await expect(page.getByLabel('Text').locator('.file-card-meta')).toHaveText('This file is missing');
  });
});

test('a link to a file in the middle of a sentence stays a link', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Inline', body: `See [plan.pdf](/files/${'1'.repeat(64)}) for details.` });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(page.getByLabel('Text').locator('.file-card')).toHaveCount(0);
  await expect(page.getByLabel('Text').locator('a', { hasText: 'plan.pdf' })).toBeVisible();
});

test('a picture shows at a sensible size with its name, and opens full size in a new tab', async ({ page, app, context }) => {
  const big = fs.readFileSync(new URL('../../public/icons/icon-1024.png', import.meta.url)).toString('base64');
  const note = await app.createNote({ title: 'Big picture' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await giveFile(page, page.getByLabel('Text'), { name: 'whiteboard.png', type: 'image/png', base64: big });
  const picture = pictures(page.getByLabel('Text'));
  await expect.poll(() => picture.evaluate((img) => img.complete && img.naturalWidth)).toBe(1024);
  const box = await picture.boundingBox();
  const text = await page.getByLabel('Text').boundingBox();
  expect(box.height).toBeLessThanOrEqual(360 + 2);
  expect(box.width).toBeLessThanOrEqual(text.width);
  await expect(page.getByLabel('Text').locator('.note-picture-name')).toHaveText('whiteboard.png');

  const opened = context.waitForEvent('page');
  await picture.click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(new RegExp(`^${app.url}/files/[0-9a-f]{64}$`));
  await tab.close();
});

// A drag the way a browser sends it: dragenter and dragover first (where the page must
// say "yes, drop here"), then drop. Returns whether the page took the drop.
async function dragFileTo(page, x, y, { name, type, base64 }) {
  return page.evaluate(({ x, y, name, type, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], name, { type }));
    const target = document.elementFromPoint(x, y);
    const fire = (kind) => {
      const event = new DragEvent(kind, { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    fire('dragenter');
    const accepted = fire('dragover');
    const outline = document.querySelector('.is-drop-target') !== null;
    const taken = fire('drop');
    return { accepted, outline, taken };
  }, { x, y, name, type, base64 });
}

test('a file let go in the empty space under the text goes into the note', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Drop zone', body: 'One line' });
  await page.goto(`${app.url}/notes/${note.id}`);
  const box = await page.getByLabel('Text').boundingBox();
  const result = await dragFileTo(page, box.x + box.width / 2, box.y + box.height - 8, { name: 'below.png', type: 'image/png', base64: png });
  expect(result).toEqual({ accepted: true, outline: true, taken: true });
  await expect(pictures(page.getByLabel('Text'))).toHaveCount(1);
  await expect(page.getByLabel('Text')).not.toHaveClass(/is-drop-target/);
  await expect(page.getByRole('status')).toHaveText('Saved');
});

test('a file let go on the title, or anywhere else on the page, goes at the end of the text', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Drop on title', body: 'Text first' });
  await page.goto(`${app.url}/notes/${note.id}`);
  const title = await page.getByLabel('Title').boundingBox();
  expect((await dragFileTo(page, title.x + 20, title.y + 10, { name: 'on-title.png', type: 'image/png', base64: png })).taken).toBe(true);
  await expect(pictures(page.getByLabel('Text'))).toHaveCount(1);
  await expect(page.getByLabel('Title')).toHaveValue('Drop on title');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const { body } = await (await fetch(`${app.url}/api/notes/${note.id}`)).json();
  expect(body).toMatch(/^Text first\n\n!\[on-title\.png\]/);
});

test('a file dragged onto the notes list is ignored, never opened in place of the app', async ({ page, app }) => {
  await app.createNote({ title: 'A card' });
  await page.goto(app.url);
  const card = await page.locator('.note-card').boundingBox();
  const result = await dragFileTo(page, card.x + 10, card.y + 10, { name: 'x.png', type: 'image/png', base64: png });
  expect(result.taken).toBe(true); // the browser's own handling (opening the file) is stopped
  await expect(page.locator('.note-card')).toHaveCount(1);
  expect(filesOnDisk(app)).toHaveLength(0);
});

test('Image in the slash menu picks a picture from the computer', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Picked' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByLabel('Text').click();
  await page.keyboard.type('/image');
  // As a person would: Enter once the menu shows Image chosen (under load Enter came too early).
  await expect(page.getByRole('option', { name: /^Image/ })).toHaveAttribute('aria-selected', 'true');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(true);
  await picker.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(pictures(page.getByLabel('Text'))).toHaveAttribute('alt', 'photo.png');
  await expect(page.getByLabel('Text')).not.toContainText('/image');
});

test('File and PDF in the slash menu pick a file too', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Picked file' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByLabel('Text').click();
  await page.keyboard.type('/pdf');
  // As a person would: Enter once the menu shows PDF chosen.
  await expect(page.getByRole('option', { name: /^PDF/ })).toHaveAttribute('aria-selected', 'true');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(page.getByLabel('Text').locator('.file-card-name')).toHaveText('plan.pdf');
  // There is a line after the card to go on writing.
  await page.keyboard.type('Written after the card');
  await expect(page.getByLabel('Text').locator('p').last()).toHaveText('Written after the card');
});

test('the journal: a file let go anywhere on the day starts a new entry with it', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect((await dragFileTo(page, heading.x + 10, heading.y + 10, { name: 'day.png', type: 'image/png', base64: png })).taken).toBe(true);
  await expect(page).toHaveURL(/\/journal\/(new|entries\/)/);
  await expect(pictures(page.getByLabel('Text'))).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page).toHaveURL(/\/journal\/entries\//);
  const entries = await (await fetch(`${app.url}/api/entries`)).json();
  expect(entries).toHaveLength(1);
  expect(filesOnDisk(app)).toHaveLength(1);
});
