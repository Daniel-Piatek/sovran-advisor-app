// The Demo launcher's icon: the app icon with a small DEMO tag in the corner, so the two
// Dock icons can't be mixed up. Writes build/demo.icns (used by npm run desktop:build -- --demo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { root, iconsetNames } from './icons.js';

const base = `data:image/png;base64,${fs.readFileSync(path.join(root, 'public/icons/icon-1024.png')).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage();
async function draw(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html, body { margin: 0; background: transparent; } div { position: relative; width: ${size}px; height: ${size}px; }
    img { width: 100%; height: 100%; display: block; }
    b { position: absolute; right: ${size * 0.04}px; bottom: ${size * 0.07}px; padding: ${size * 0.02}px ${size * 0.06}px; border-radius: ${size * 0.05}px;
      background: #f4f4f1; border: ${Math.max(1, size * 0.012)}px solid #1d1d1f; color: #1d1d1f; font: 800 ${size * 0.15}px/1.1 -apple-system, Helvetica, sans-serif; letter-spacing: ${size * 0.01}px; }</style>
    <div><img src="${base}"><b>DEMO</b></div>`);
  await page.locator('img').evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-icon-')) + '/demo.iconset';
fs.mkdirSync(iconset);
const drawn = {};
for (const [name, size] of Object.entries(iconsetNames)) fs.writeFileSync(path.join(iconset, name), drawn[size] ??= await draw(size));
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
execFileSync('iconutil', ['-c', 'icns', '-o', path.join(root, 'build/demo.icns'), iconset]);
fs.writeFileSync(path.join(root, 'build/demo-icon.png'), drawn[1024]);
fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
await browser.close();
