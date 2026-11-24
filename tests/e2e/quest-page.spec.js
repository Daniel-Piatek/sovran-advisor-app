// The Sovran Quest page shows the homework and the call's summary as Daniel formatted them (2026-11-24): bold, a colour,
// a highlight, underline, a list, a link. The weeks come from a stand-in (useQuest), as the group's cloud shelf would
// give them; Start with Sovran Advisor puts the homework's plain words in the box.

import { test, expect } from '@playwright/test';
import { startServer } from '../../server.js';
import { useQuest } from '../../quest.js';

const WEEKS = [{
  group: 'SQ01', number: 2, title: 'Meeting the Tyrant', call_on: '2026-11-23', practice_url: 'https://practice.example.com/sq01', replay_url: '',
  homework: [{ text: 'Write about **[one moment]{.c-violet}** the Tyrant [showed up]{.hl-yellow}.', where: 'journal' },
    { text: 'Ask about [your pattern]{.underline} and ~~skip~~ [read this](https://example.com/read).', where: 'advisor' }],
  summary: 'We met the *Tyrant*.\n\n- Notice it\n- Name it', transcript: '',
}];

test('the homework and the summary keep how Daniel formatted them', async ({ page }, testInfo) => {
  const app = await startServer({ dataDir: testInfo.outputPath('data'), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0 });
  useQuest({ weeks: async () => WEEKS, guide: false });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  try {
    await page.goto(`${app.url}/quest`);
    const pieces = page.locator('.quest-piece-text');
    await expect(pieces.nth(0)).toHaveText('Write about one moment the Tyrant showed up.');
    await expect(pieces.nth(0).locator('strong .fc-violet, .fc-violet strong')).toHaveText('one moment');
    await expect(pieces.nth(0).locator('mark.hl-yellow')).toHaveText('showed up');
    await expect(pieces.nth(1).locator('u')).toHaveText('your pattern');
    await expect(pieces.nth(1).locator('s')).toHaveText('skip');
    await expect(pieces.nth(1).getByRole('link', { name: 'read this' })).toHaveAttribute('target', '_blank');
    await expect(page.locator('.quest-summary em')).toHaveText('Tyrant');
    await expect(page.locator('.quest-summary li')).toHaveText(['Notice it', 'Name it']);
    // Sovran Advisor gets the words alone.
    await page.locator('.quest-bar').nth(1).getByRole('button', { name: 'Start with Sovran Advisor' }).click();
    await expect(page.getByRole('textbox').filter({ hasText: /homework/ }).or(page.locator('textarea:visible').first())).toHaveValue(/“Ask about your pattern and skip read this\.”/);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
