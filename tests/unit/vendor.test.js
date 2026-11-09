// The editor's building blocks in public/vendor/ (made by `npm run vendor`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { vendorFiles, vendorDir, packages } from '../../scripts/vendor.js';

const stale = 'run `npm run vendor` after changing an editor package in package.json';

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

test('public/vendor/ matches the installed packages exactly', () => {
  const expected = vendorFiles();
  assert.deepEqual(filesIn(vendorDir), [...expected.keys()].sort(), stale);
  for (const [file, text] of expected) assert.equal(fs.readFileSync(file, 'utf8'), text, `${file}: ${stale}`);
});

test('every copied package brings its licence', () => {
  const dirs = fs.readdirSync(vendorDir);
  for (const pkg of dirs) {
    assert.ok(fs.readdirSync(path.join(vendorDir, pkg)).some((name) => /^licen[cs]e/i.test(name)), `${pkg} licence`);
  }
  for (const pkg of packages) assert.ok(dirs.includes(pkg), pkg);
});

test('no copied file still imports a package by name', () => {
  for (const file of filesIn(vendorDir).filter((f) => /\.m?js$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('.') || m[1].startsWith('/vendor/'), `${path.relative(vendorDir, file)} imports ${m[1]}`);
    }
  }
});
