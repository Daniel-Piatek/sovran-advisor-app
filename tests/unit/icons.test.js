// The app icon: one source (design/icon.svg), every size made from it by `npm run icons`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { outDir, root, roundSvg, tileSvg, manifest, pngs, readTokens, ico } from '../../scripts/icons.js';

const stale = 'run `npm run icons` after changing design/icon.svg or an icon token';

test('the generated icons still match the source and the tokens', () => {
  assert.equal(fs.readFileSync(`${outDir}favicon.svg`, 'utf8'), roundSvg(), stale);
  assert.equal(fs.readFileSync(`${root}public/manifest.webmanifest`, 'utf8'), manifest(), stale);
});

test('every size is there', () => {
  const expected = ['favicon.svg', 'favicon.ico', 'app.icns', ...pngs.map((p) => p.file)].sort();
  assert.deepEqual(fs.readdirSync(outDir).sort(), expected);
});

test('the icon colours come from the tokens', () => {
  const tokens = readTokens();
  for (const name of ['--icon-ring', '--icon-crown', '--icon-base', '--icon-inner']) {
    assert.match(tokens[name], /^#[0-9a-f]{6}$/i, `${name} is a colour`);
    assert.ok(roundSvg().includes(`${name}: ${tokens[name]};`), `${name} is in the icon`);
  }
  assert.equal(tokens['--icon-inner'], tokens['--color-bg'], 'the inner disc is the page colour');
});

test('the icon preserves the exact Live Sovran logo supplied by the owner', () => {
  const embedded = roundSvg().match(/href="data:image\/png;base64,([^"]+)"/);
  assert.ok(embedded, 'the supplied PNG is embedded in the icon source');
  const hash = createHash('sha256').update(Buffer.from(embedded[1], 'base64')).digest('hex');
  assert.equal(hash, 'fdd38f03040728f55c15d19a743d6e2d915077e0a3385ff6acab6f68f2155d62');
});

test('the tile version fills the whole square', () => {
  assert.match(tileSvg(), /<rect width="300" height="300" style="fill: var\(--icon-base\)"\/>/);
});

test('a .ico holds each picture with its size', () => {
  const file = ico([{ size: 16, png: Buffer.from('aa') }, { size: 32, png: Buffer.from('bbb') }]);
  assert.equal(file.readUInt16LE(4), 2);
  assert.equal(file.readUInt8(6), 16);
  assert.equal(file.readUInt8(22), 32);
  assert.equal(file.readUInt32LE(6 + 8), 2);
  assert.equal(file.readUInt32LE(6 + 12), 38);
  assert.equal(file.subarray(38, 40).toString(), 'aa');
});
