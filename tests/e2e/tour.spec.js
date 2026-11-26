import fs from 'node:fs';
// The Tour (public/tour.js): Tour sits just above Settings; the basics film first, then a card for each part you can
// switch on, in the owner's order, each with its own short film and "Switch it on".
import { test, expect } from './fixtures.js';

const ORDER = ['Sovran Quest', 'Group Circle', 'go Sovran', 'Tasks', 'Planner', 'Calendar', 'Boards', 'My Life', 'Your Sidebar'];

test('Tour sits just above Help and Settings, and opens the films', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  if (test.info().project.name === 'phone') {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Tour' }).click();
  } else {
    const tour = page.locator('.sidebar > .sidebar-link[data-section="Tour"]');
    await expect(tour).toBeVisible();
    await expect(page.locator('.sidebar > .sidebar-link[data-section="Tour"] + .sidebar-link')).toHaveAttribute('data-section', 'Help');
    await tour.click();
  }
  await expect(page).toHaveURL(/\/tour$/);
  await expect(page.getByRole('heading', { name: 'Tour', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Basics' })).toBeVisible();
  await expect(page.locator('.tour-card-title')).toHaveText(ORDER);
  await expect(page.getByText('Your Sovran Library')).toBeVisible();
});

test('Switch it on switches the part on, and its card offers to open it', async ({ page, app }) => {
  await page.request.patch(`${app.url}/api/modules`, { data: { id: 'tasks', on: false } }); // off, as in a new install
  await page.goto(`${app.url}/tour`);
  const card = page.locator('.tour-card[data-film="tasks"]');
  await card.getByRole('button', { name: 'Switch it on' }).click();
  await expect(card.getByText('On', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/tasks');
  const modules = await (await page.request.get(`${app.url}/api/modules`)).json();
  expect(modules.find((m) => m.id === 'tasks').on).toBe(true);
  if (test.info().project.name !== 'phone') await expect(page.locator('.sidebar-link[data-section="Tasks"]')).toBeVisible();
});

test('a film plays inside the app, without its own title, and All Videos and Back to All Videos go back', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  await page.locator('.tour-card[data-film="planner"]').getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(/\/tour\?film=planner$/);
  await expect(page.getByRole('heading', { name: 'Planner', level: 1 })).toBeVisible();
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('Switch On Planner');
  await expect(film.locator('html')).toHaveClass(/in-app/);
  await expect(film.locator('.wrap > h1')).toBeHidden();
  await expect(page.getByRole('link', { name: 'All Videos', exact: true })).toBeVisible();
  await film.getByRole('link', { name: '← Back to All Videos' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(9);
});

test('the basics film and its voice are served by the app', async ({ page, app }) => {
  const film = await page.request.get(`${app.url}/tour/basics.html`);
  expect(film.status()).toBe(200);
  expect(await film.text()).not.toContain('fonts.googleapis.com');
  const voice = await page.request.get(`${app.url}/tour/voice/basics/t01-00.mp3`);
  expect(voice.status()).toBe(200);
  expect(voice.headers()['content-type']).toBe('audio/mpeg');
});

test('the Sovran Library line opens Settings at the key box, ready to paste', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  await page.getByRole('link', { name: 'Paste your key →' }).click();
  await expect(page).toHaveURL(/\/settings#sovran-library$/);
  await expect(page.getByRole('textbox', { name: 'Library key' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Library key' })).toBeInViewport();
});

test('the next and previous chapter buttons and the arrow keys move a chapter, within that video', async ({ page, app }) => {
  await page.goto(`${app.url}/tour?film=planner`);
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('Switch On Planner');
  await film.getByRole('button', { name: 'Next chapter' }).click();
  await expect(film.locator('#caph')).toHaveText('Plan Your Day');
  await film.locator('body').press('ArrowRight');
  await expect(film.locator('#caph')).toHaveText('A Highlight, and Closing the Day');
  await film.getByRole('button', { name: 'Next chapter' }).click(); // the last chapter of this video: it stays
  await expect(film.locator('#caph')).toHaveText('A Highlight, and Closing the Day');
  await film.getByRole('button', { name: 'Previous chapter' }).click();
  await expect(film.locator('#caph')).toHaveText('Plan Your Day');
});

test('a click on the progress line goes to that chapter, in every film (D, 26 Nov 2026)', async ({ page, app }) => {
  // the line is split evenly by chapter: a click near its end is the last chapter, near its start the first
  await page.goto(`${app.url}/tour?film=planner`);
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('Switch On Planner');
  const line = film.locator('.bar');
  await expect(line).toHaveCSS('cursor', 'pointer');
  await line.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await line.boundingBox();
  await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
  await expect(film.locator('#caph')).toHaveText('A Highlight, and Closing the Day'); // the last chapter of this video, not of the next one
  await page.mouse.click(box.x + box.width * 0.02, box.y + box.height / 2);
  await expect(film.locator('#caph')).toHaveText('Switch On Planner');
  // a drag along the line goes where it lets go
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(film.locator('#caph')).toHaveText('Plan Your Day');
  // the phone film has the same line
  await page.goto(`${app.url}/tour?film=phone`);
  const phone = page.frameLocator('.tour-frame');
  await expect(phone.locator('#gf-h')).toHaveText('This Is go Sovran');
  await page.waitForTimeout(1500); // it starts playing a moment after it is on screen
  const pline = phone.locator('.gf-bar');
  await pline.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const n = await phone.locator('.gf-scene').count();
  const pb = await pline.boundingBox();
  await page.mouse.click(pb.x + pb.width * 0.99, pb.y + pb.height / 2);
  await expect(phone.locator('#gf-n')).toHaveText(`Chapter ${n} of ${n}`);
});

test('Group Circle has its own film: on already, it opens the group, and the Group Circle help links to it', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  const card = page.locator('.tour-card[data-film="group"]');
  await expect(card.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/group');
  await card.getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(/\/tour\?film=group$/);
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('What Group Circle Is');
  await expect(film.locator('.tour-note')).toBeHidden(); // "click Tour in your sidebar" is for the shared web page only
  await expect(film.locator('#scenes .scene')).toHaveCount(10); // six, then four on alerts (2026-11-22)
  expect(fs.readFileSync(new URL('../../docs/group.md', import.meta.url), 'utf8')).toContain('(/tour?film=group)');
});

test('the go Sovran card plays the go Sovran film, and its Back to All Videos comes back', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  await page.locator('.tour-card[data-film="phone"]').getByRole('link', { name: 'Watch' }).click();
  await expect(page.getByRole('heading', { name: 'go Sovran', level: 1 })).toBeVisible();
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#gf-h')).toHaveText('This Is go Sovran');
  await expect(film.locator('#gf-img')).toHaveJSProperty('complete', true);
  expect(await film.locator('#gf-img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await film.getByRole('button', { name: 'Next chapter' }).click();
  await expect(film.locator('#gf-h')).toHaveText('Three Ways to Write');
  // its voice: one click on Sound on (it comes on by itself where the browser lets it), and Mute again
  const snd = film.locator('#gf-snd');
  if ((await snd.getAttribute('aria-pressed')) !== 'true') await snd.click();
  await expect(snd).toHaveText('🔇 Mute');
  await snd.click();
  await expect(snd).toHaveText('🔊 Sound on');
  const voice = await page.request.get(`${app.url}/tour/voice/sovran-go/g01-00s.mp3`);
  expect(voice.status()).toBe(200);
  expect(voice.headers()['content-type']).toBe('audio/mpeg');
  await film.getByRole('link', { name: '← Back to All Videos' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(9);
});

test('Your Sidebar has its own film, with the owner’s voice, and its card goes to Settings', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  const card = page.locator('.tour-card[data-film="sidebar"]');
  await expect(card.getByRole('link', { name: 'Settings →' })).toHaveAttribute('href', '/settings');
  await card.getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(/\/tour\?film=sidebar$/);
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('Your Sidebar, Your Way');
  const voice = await page.request.get(`${app.url}/tour/voice/sidebar/s02-01b.mp3`);
  expect(voice.status()).toBe(200);
});

test('Sovran Quest has its own film, with the owner’s voice: on already, it opens Sovran Quest, and the Quest help links to it', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  const card = page.locator('.tour-card[data-film="quest"]');
  await expect(card.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/quest');
  await card.getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(/\/tour\?film=quest$/);
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('What Sovran Quest Is');
  await expect(film.locator('.tour-note')).toBeHidden();
  await expect(film.locator('#scenes .scene')).toHaveCount(9); // six on the computer, three on the phone
  const voice = await page.request.get(`${app.url}/tour/voice/quest/q01-00.mp3`);
  expect(voice.status()).toBe(200);
  expect(fs.readFileSync(new URL('../../docs/quest.md', import.meta.url), 'utf8')).toContain('(/tour?film=quest)');
});

// "How <the page> works" (public/page-video.js, 2026-11-24, the owner's wish): the page's own film, from the page itself,
// and both of the film's back buttons go back to that page.
test('a page with a film offers How … works, and the film goes back to that page', async ({ page, app }) => {
  await page.goto(`${app.url}/quest`);
  const link = page.locator('.page-video-line > .page-video');
  await expect(link).toHaveText('How Sovran Quest works');
  await link.click();
  await expect(page).toHaveURL(/\/tour\?film=quest&back=%2Fquest$/);
  await expect(page.getByRole('heading', { name: 'Sovran Quest', level: 1 })).toBeVisible();
  await expect(page.locator('.top-bar .tour-back-to')).toHaveText('← Sovran Quest Module');
  await expect(page.locator('.tour-film-head .tour-state')).toHaveCount(0); // no On / Open →: they came from it
  await expect(page.locator('.top-bar .tour-all')).toHaveAttribute('href', '/tour');
  const inside = page.frameLocator('.tour-frame').locator('#back-all');
  await expect(inside).toHaveText('← Sovran Quest Module');
  await inside.click();
  await expect(page).toHaveURL(/\/quest$/);
  await page.locator('.page-video-line > .page-video').click();
  await page.locator('.top-bar .tour-back-to').click();
  await expect(page).toHaveURL(/\/quest$/);

  await page.goto(`${app.url}/group`);
  await expect(page.locator('.page-video-line > .page-video')).toHaveText('How Group Circle works');
  await page.goto(`${app.url}/journal`); // no film of its own
  await expect(page.locator('.page-video')).toHaveCount(0);
  // From a part of Settings: back to that part, open.
  await page.goto(`${app.url}/settings`);
  await page.locator('#sidebar-part .page-video').click();
  await expect(page.locator('.top-bar .tour-back-to')).toHaveText('← Settings');
  await page.locator('.top-bar .tour-back-to').click();
  await expect(page).toHaveURL(/\/settings#sidebar-part$/);
  await expect(page.locator('#sidebar-part').getByRole('button', { name: 'Arrange the sidebar' })).toBeVisible();
});

test('a back address that is not one of the app’s own pages is not offered', async ({ page, app }) => {
  await page.goto(`${app.url}/tour?film=quest&back=${encodeURIComponent('//example.com')}`);
  await expect(page.locator('.top-bar .tour-back')).toHaveText('All Videos');
});
