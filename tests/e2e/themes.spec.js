import { test, expect } from './fixtures.js';

const pureBlack = 'rgb(0, 0, 0)';
const pureWhite = 'rgb(255, 255, 255)';

for (const theme of ['light', 'dark']) {
  test(`the ${theme} theme comes from the tokens, with no pure black or white`, async ({ page, app }) => {
    await page.goto(`${app.url}/notes`);
    if (theme === 'dark') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });

    const seen = await page.evaluate(() => {
      const tokens = getComputedStyle(document.documentElement);
      // Let the browser turn each token into the rgb() form it reports for elements.
      const asRgb = (name) => {
        const probe = document.createElement('div');
        probe.style.color = tokens.getPropertyValue(name);
        document.body.append(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      };
      return {
        // The frame around the screen is the surface's grey; the screen itself, the page colour.
        frame: getComputedStyle(document.body).backgroundColor,
        tokenSurface: asRgb('--color-surface'),
        background: getComputedStyle(document.getElementById('app')).backgroundColor,
        text: getComputedStyle(document.body).color,
        muted: getComputedStyle(document.querySelector('.empty')).color,
        tokenBackground: asRgb('--color-bg'),
        tokenText: asRgb('--color-text'),
        tokenMuted: asRgb('--color-text-muted'),
      };
    });

    expect(seen.frame).toBe(seen.tokenSurface);
    expect(seen.background).toBe(seen.tokenBackground);
    expect(seen.text).toBe(seen.tokenText);
    expect(seen.muted).toBe(seen.tokenMuted);
    for (const colour of [seen.frame, seen.background, seen.text, seen.muted]) {
      expect(colour).not.toBe(pureBlack);
      expect(colour).not.toBe(pureWhite);
    }
  });
}

test('the two themes really differ', async ({ page, app }) => {
  await page.goto(app.url);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect(await background()).not.toBe(light);
});
