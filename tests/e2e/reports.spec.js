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
  await expect(card).toContainText('your Pattern shows your natural gifts and your challenges as one whole'); // what the report is, not its sections
  await expect(card.locator('img.report-card-picture')).toHaveAttribute('src', '/brand/sovran-pattern-report.png'); // the Pattern's own picture
  await expect(page.getByText('A draft')).toHaveCount(0);
  await expect(card.getByRole('link', { name: /Download/ })).toHaveCount(0); // the downloads are on the report's own page

  await card.getByRole('heading', { name: 'Your Made-up Pattern' }).click();
  await expect(page).toHaveURL(/\/reports\/pattern$/);
  await expect(page.getByRole('heading', { name: 'Your Made-up Pattern', level: 1 })).toBeVisible();
  await expect(page.locator('.report-text strong')).toHaveText('definition');
  await expect(page.getByRole('heading', { name: 'A Part Inside', level: 3 })).toBeVisible();
  // The Ivory & Gold look: the cover's crown and wordmark, PART labels after the opening section, a drop cap on each part.
  await expect(page.locator('.report-paper .report-cover img.report-crown')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Live Sovran' })).toBeVisible();
  await expect(page.locator('.report-part-label')).toHaveText(['Part One', 'Part Two']);
  await expect(page.locator('#section-before-you-begin .report-part-label')).toHaveCount(0);
  await expect(page.locator('#section-your-gifts .report-text > p.report-lede')).toHaveCount(1);
  await expect(page.locator('.report-cover .report-file')).toHaveText([/PDF download/]);
  // Wide: the ivory sheet with a comments column beside it, headed Your comments, with a how-to while there are none.
  const head = page.locator('.report-comments-head');
  if (test.info().project.name === 'phone') await expect(head).toBeHidden();
  else await expect(head).toContainText('Your commentsSelect any words in the report'); // only the white PDF; no file for your AI
  const contents = page.getByRole('navigation', { name: 'Contents' });
  await expect(contents.getByRole('button')).toHaveText(['Before You Begin', 'Your Gifts', 'The Door That Opens']);
  await contents.getByRole('button', { name: 'The Door That Opens' }).click();
  await expect(page.locator('#section-the-door-that-opens')).toBeInViewport();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'PDF download' }).click()]);
  expect(download.suggestedFilename()).toBe('Your-Pattern.pdf');
  await expect(page.getByRole('link', { name: /for your AI/ })).toHaveCount(0);
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

// Ask about this (2026-11-17): select words, press the robot's Ask about this, ask; the answer comes in beside the words and
// stays there (and in the Assistant's chats); a second question carries on the same chat; the assistant reads them with the report.
test('ask the assistant about chosen words: the answer beside them, kept, and carried on', async ({ page, app }) => {
  place(app, 'pattern');
  await page.goto(`${app.url}/reports/pattern`);
  await choose(page, 'your-gifts', 'notice things');
  const pick = page.getByRole('toolbar', { name: 'Mark these words' });
  const ask = pick.getByRole('button', { name: 'Ask about this' });
  await expect(ask.locator('[data-icon="assistant"]')).toHaveCount(1); // the Assistant's own robot face
  await ask.click();
  const pop = page.getByRole('dialog', { name: 'Ask Sovran Advisor' });
  await pop.getByRole('textbox', { name: 'Your question' }).fill('What does this mean for my work?');
  await pop.getByRole('button', { name: 'Ask' }).click();
  // The stand-in answers with what it was sent: the question, the page, and the words with their section.
  const answer = pop.locator('.report-ask-a');
  await expect(answer).toContainText('You said: What does this mean for my work?');
  await expect(answer).toContainText('selected these words in “Your Gifts” in their Your Made-up Pattern');
  await expect(answer).toContainText('“notice things”');
  await expect(page.locator('#section-your-gifts mark.has-ask')).toHaveText('notice things');
  await expect(page.locator('#section-your-gifts .report-margin-note.is-ask')).toContainText('What does this mean for my work?');

  // A second question goes on in the same chat.
  await pop.getByRole('textbox', { name: 'Your question' }).fill('And at home?');
  await pop.getByRole('button', { name: 'Ask' }).click();
  await expect(pop.locator('.report-ask-q')).toHaveText(['What does this mean for my work?', 'And at home?']);
  await expect(pop.locator('.report-ask-a').nth(1)).toContainText('You said: And at home?');
  await expect(pop.locator('.report-ask-a').nth(1)).toContainText('still asking about the words');

  // Kept: after a reload, beside the words; one chat in the Assistant, named after the words; read with the report.
  await page.reload();
  await expect(page.locator('#section-your-gifts .report-margin-note.is-ask')).toContainText('And at home?');
  await expect(page.locator('#section-your-gifts .report-margin-note.is-ask')).toContainText('2 questions');
  const marks = await (await page.request.get(`${app.url}/api/reports/pattern/marks`)).json();
  expect(marks[0].asks.map((a) => a.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  const chats = await (await page.request.get(`${app.url}/api/conversations`)).json();
  expect(chats.map((c) => c.title)).toEqual(['Report: “notice things”']);
  await page.locator('#section-your-gifts mark.report-mark').click();
  await expect(pop.locator('.report-ask-q')).toHaveCount(2);
  await pop.getByRole('link', { name: 'Open in Sovran Advisor' }).click();
  await expect(page).toHaveURL(new RegExp(`/assistant/${chats[0].id}$`));
});

// The Pattern's break line in Part Five (2026-11-17, the owner's wish): a short centred gold bar, never shown as text,
// whether the line arrives as it is or written with &lt; &gt; &quot;.
test('a break line is drawn as a short gold bar, never as text', async ({ page, app }) => {
  const sections = [
    SECTIONS[0],
    { ...SECTIONS[1], body: 'Before the break.\n\n<div class="break"></div>\n\nAfter the break.' },
    { ...SECTIONS[3], body: 'Once more.\n&lt;div class=&quot;break&quot;&gt;&lt;/div&gt;\nAnd the end.' },
  ];
  place(app, 'pattern', { sections });
  await page.goto(`${app.url}/reports/pattern`);
  await expect(page.locator('.report-text').nth(1)).toContainText('After the break.');
  await expect(page.locator('.report-break')).toHaveCount(2);
  await expect(page.locator('.report-body')).not.toContainText('div');
  await expect(page.locator('.report-body')).not.toContainText('break"');
  const bar = await page.locator('#section-your-gifts .report-break').evaluate((node) => {
    const s = getComputedStyle(node);
    const text = node.parentElement.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return { height: box.height, share: box.width / text.width, colour: s.backgroundColor, centred: Math.abs((box.left - text.left) - (text.right - box.right)) < 1,
      above: parseFloat(s.marginTop), below: parseFloat(s.marginBottom) };
  });
  expect(bar.height).toBe(2);
  expect(bar.share).toBeCloseTo(0.34, 2);
  expect(bar.colour).toBe('rgb(217, 193, 75)');
  expect(bar.centred).toBe(true);
  expect(bar.above).toBeGreaterThan(20);
  expect(bar.below).toBeGreaterThan(20);
  // The drop cap still sits on the part's first paragraph.
  await expect(page.locator('#section-your-gifts .report-text > p.report-lede')).toHaveText('Before the break.');
});
