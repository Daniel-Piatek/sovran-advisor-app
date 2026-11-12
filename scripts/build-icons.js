// Makes every size of the app icon from design/icon.svg: `npm run icons`.
// It draws the pictures with the test browser (Playwright's Chromium, already in the
// project) and makes the macOS .icns with macOS's own iconutil. Writes public/icons/
// and public/manifest.webmanifest.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { root, outDir, roundSvg, tileSvg, pngs, icnsSizes, iconsetNames, manifest, quickManifest, ico } from './icons.js';

const svgs = { round: roundSvg(), tile: tileSvg() };

const browser = await chromium.launch();
const page = await browser.newPage();

async function draw(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(`<style>html, body { margin: 0; background: transparent; }</style>` +
    `<img src="${src}" width="${size}" height="${size}" style="display: block">`);
  await page.locator('img').evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'favicon.svg'), svgs.round);

const drawn = {};
for (const { file, size, shape } of pngs) {
  const png = await draw(svgs[shape], size);
  fs.writeFileSync(path.join(outDir, file), png);
  if (shape === 'round') drawn[size] = png;
}

fs.writeFileSync(path.join(outDir, 'favicon.ico'), ico([16, 32, 48].map((size) => ({ size, png: drawn[size] }))));

const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-')) + '/app.iconset';
fs.mkdirSync(iconset);
for (const size of icnsSizes) drawn[size] ??= await draw(svgs.round, size);
for (const [name, size] of Object.entries(iconsetNames)) fs.writeFileSync(path.join(iconset, name), drawn[size]);
execFileSync('iconutil', ['-c', 'icns', '-o', path.join(outDir, 'app.icns'), iconset]);
fs.rmSync(path.dirname(iconset), { recursive: true, force: true });

fs.writeFileSync(path.join(root, 'public', 'manifest.webmanifest'), manifest());
fs.writeFileSync(path.join(root, 'public', 'quick.webmanifest'), quickManifest());

await browser.close();
for (const file of fs.readdirSync(outDir).sort()) {
  console.log(`public/icons/${file}  ${fs.statSync(path.join(outDir, file)).size} bytes`);
}
console.log('public/manifest.webmanifest');
console.log('public/quick.webmanifest');
