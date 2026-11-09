import { test, expect } from './fixtures.js';

test('the page links its icons, and every one loads', async ({ page, app }) => {
  await page.goto(app.url);
  const links = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  expect(links).toEqual(['/icons/favicon.svg', '/icons/favicon-32.png', '/icons/apple-touch-icon.png', '/manifest.webmanifest']);

  const manifest = await (await page.request.get(`${app.url}/manifest.webmanifest`)).json();
  for (const href of [...links, '/icons/favicon.ico', '/icons/app.icns', ...manifest.icons.map((i) => i.src)]) {
    const res = await page.request.get(app.url + href);
    expect(res.status(), href).toBe(200);
  }
  expect((await page.request.get(`${app.url}/icons/favicon.svg`)).headers()['content-type']).toContain('image/svg+xml');
  expect(manifest.icons.map((i) => i.purpose)).toContain('maskable');
});

test('the browser shows the icon at its real size', async ({ page, app }) => {
  await page.goto(app.url);
  const size = await page.evaluate(async () => {
    const img = new Image();
    img.src = '/icons/favicon-16.png';
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  });
  expect(size).toEqual([16, 16]);
});
