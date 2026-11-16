// Reports (module reports): the list with the Layered Portrait's place at the top, a report to read with its contents and
// downloads, and nothing while the module is off. Without a library key the app reads made-up reports from the test's own
// data folder (reports.js); the library itself is covered by tests/unit/reports.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';

// Reports is off in a new install (modules.js, starter: false): these tests switch it on.
test.beforeEach(async ({ app }) => {
  await fetch(`${app.url}/api/modules`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'reports', on: true }) });
});

const SECTIONS = [
  { position: 1, level: 1, parent: null, section_key: 'before-you-begin', title: 'Before You Begin', body: 'A mirror, not a **definition**.' },
  { position: 2, level: 1, parent: null, section_key: 'your-gifts', title: 'Your Gifts', body: 'You notice things.' },
  { position: 3, level: 2, parent: 2, section_key: 'a-part-inside', title: 'A Part Inside', body: 'Quietly so.' },
  { position: 4, level: 1, parent: null, section_key: 'the-door-that-opens', title: 'The Door That Opens', body: `${Array(60).fill('What may come.').join(' ')} The last door.` },
];

function place(app, report, extra = {}, files = {}) {
  const dir = path.join(app.dataDir, 'reports', report);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ report, title: 'Your Made-up Pattern', version: 2, status: 'final', approved_on: '2026-08-24', words: 5227, sections: SECTIONS, files: [], ...extra }));
}

test('the list, then a report to read with its contents and its downloads', async ({ page, app }) => {
  place(app, 'pattern', { files: [{ kind: 'pdf', file_name: 'Your-Pattern.pdf', bytes: 9 }, { kind: 'for-your-ai', file_name: 'For-AI.md', bytes: 5 }] },
    { 'Your-Pattern.pdf': '%PDF-1.4 x', 'For-AI.md': 'notes' });
  place(app, 'old-draft', { status: 'draft', title: 'A draft' });
  await page.goto(`${app.url}/reports`);
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.getByText('begins here and grows as you go through the Sovran Quest')).toBeVisible();
  const card = page.locator('.report-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Version 2');
  await expect(card).toContainText('5,227 words');
  await expect(card).toContainText('Before You Begin · Your Gifts · The Door That Opens');
  await expect(page.getByText('A draft')).toHaveCount(0);
  await expect(card.getByRole('link', { name: /Download/ })).toHaveCount(0); // the downloads are on the report's own page

  await card.getByRole('heading', { name: 'Your Made-up Pattern' }).click();
  await expect(page).toHaveURL(/\/reports\/pattern$/);
  await expect(page.getByRole('heading', { name: 'Your Made-up Pattern', level: 1 })).toBeVisible();
  await expect(page.locator('.report-text strong')).toHaveText('definition');
  await expect(page.getByRole('heading', { name: 'A Part Inside', level: 3 })).toBeVisible();
  const contents = page.getByRole('navigation', { name: 'Contents' });
  await expect(contents.getByRole('button')).toHaveText(['Before You Begin', 'Your Gifts', 'The Door That Opens']);
  await contents.getByRole('button', { name: 'The Door That Opens' }).click();
  await expect(page.locator('#section-the-door-that-opens')).toBeInViewport();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download the PDF' }).click()]);
  expect(download.suggestedFilename()).toBe('Your-Pattern.pdf');
  await expect(page.getByRole('link', { name: 'Download the file for your AI' })).toBeVisible();
});

test.describe(() => {
  test.use({ expectedConsoleErrors: [/status of 40[49]/] });
  test('no reports yet, an unknown report, and switched off', async ({ page, app }) => {
  await page.goto(`${app.url}/reports`);
  await expect(page.getByText('No reports yet. Each one appears here once it is ready.')).toBeVisible();
  await page.goto(`${app.url}/reports/nothing`);
  await expect(page.getByText('There is no such report.')).toBeVisible();
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="reports"]').getByRole('button', { name: 'Off' }).click();
  await page.goto(`${app.url}/reports`);
  await expect(page.getByText('No reports yet.')).toBeVisible();
  expect((await page.request.get(`${app.url}/api/reports/pattern`)).status()).toBe(409);
});
});

// Highlights and comments (public/report-marks.js, report-marks.js): select words, Highlight or Comment; the comment beside the
// section; Your highlights at the top; Remove with Undo; kept after a reload; the report's own text unchanged.
async function choose(page, sectionKey, words) {
  await page.locator(`#section-${sectionKey} .report-text`).evaluate((root, w) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.data.indexOf(w);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(n, at + 1); // a part of the first word: the page takes it whole
      range.setEnd(n, at + w.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
  }, words);
}

test('highlight words, comment on others, see them beside the text and in Your highlights, remove with Undo', async ({ page, app }) => {
  place(app, 'pattern');
  await page.goto(`${app.url}/reports/pattern`);
  await choose(page, 'your-gifts', 'notice things');
  const pick = page.getByRole('toolbar', { name: 'Mark these words' });
  await pick.getByRole('button', { name: 'Highlight' }).click();
  await expect(page.locator('#section-your-gifts mark.report-mark')).toHaveText('notice things');

  await choose(page, 'before-you-begin', 'mirror');
  await pick.getByRole('button', { name: 'Comment' }).click();
  const pop = page.getByRole('dialog', { name: 'Your comment' });
  await pop.getByRole('textbox').fill('Is this true for me?');
  await pop.getByRole('button', { name: 'Save comment' }).click();
  await expect(page.locator('#section-before-you-begin mark.has-comment')).toHaveText('mirror');
  await expect(page.locator('#section-before-you-begin .report-margin-note')).toContainText('Is this true for me?');
  await expect(page.locator('.report-my summary')).toContainText('2 highlights, 1 with a comment');

  // A comment far down a long section sits level with its words on a wide screen (under the section on a phone).
  await choose(page, 'the-door-that-opens', 'last door');
  await pick.getByRole('button', { name: 'Comment' }).click();
  await pop.getByRole('textbox').fill('Where does it lead?');
  await pop.getByRole('button', { name: 'Save comment' }).click();
  const note = page.locator('#section-the-door-that-opens .report-margin-note');
  await expect(note).toContainText('Where does it lead?');
  const [noteBox, markBox] = [await note.boundingBox(), await page.locator('#section-the-door-that-opens mark').boundingBox()];
  if ((page.viewportSize()?.width ?? 0) > 1100) expect(Math.abs(noteBox.y - markBox.y)).toBeLessThan(4);
  else expect(noteBox.y).toBeGreaterThan(markBox.y);
  await page.locator('#section-the-door-that-opens mark').click();
  await pop.getByRole('button', { name: 'Remove highlight' }).click();

  await page.reload();
  await expect(page.locator('mark.report-mark')).toHaveCount(2);
  const marks = await (await page.request.get(`${app.url}/api/reports/pattern/marks`)).json();
  expect(marks.map((m) => m.quote).sort()).toEqual(['mirror', 'notice things']);

  await page.locator('#section-your-gifts mark.report-mark').click();
  await pop.getByRole('button', { name: 'Remove highlight' }).click();
  await expect(page.locator('#section-your-gifts mark')).toHaveCount(0);
  await expect(page.locator('#section-your-gifts .report-text')).toHaveText('You notice things.');
  await page.locator('.report-undo').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#section-your-gifts mark.report-mark')).toHaveText('notice things');
});
