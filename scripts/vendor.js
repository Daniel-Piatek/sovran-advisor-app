// Copies the editor's building blocks (ProseMirror and its Markdown reader) from
// node_modules into public/vendor/, so the page can load them: `npm run vendor`.
// The app has no build step, so each package's own browser files are copied as they are,
// with every `import 'package'` pointed at its copy. Run it after changing a version in
// package.json, and commit the result; a test fails if public/vendor/ is out of date.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const modules = path.join(root, 'node_modules');
export const vendorDir = path.join(root, 'public', 'vendor');

// What public/editor.js imports. Everything these import comes along.
export const packages = [
  'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-transform',
  'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-history', 'prosemirror-inputrules',
  'prosemirror-schema-list', 'prosemirror-markdown',
];

const importPattern = /((?:import|export)\s[^'"]*?from\s*|import\s*)(['"])([^'"]+)\2/g;

function packageOf(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

// The file a package gives a browser (its ES module entry).
function entryOf(pkg) {
  const json = JSON.parse(fs.readFileSync(path.join(modules, pkg, 'package.json'), 'utf8'));
  const main = json.exports?.['.'];
  const file = (typeof main === 'object' ? main.import?.default ?? main.import ?? main.default : null) ?? json.module ?? json.main;
  return path.join(modules, pkg, file);
}

const urlOf = (file) => `/vendor/${path.relative(modules, file).split(path.sep).join('/')}`;

// Every file to copy, with its imports pointed at the copies: { 'public/vendor/…': text }.
export function vendorFiles() {
  const out = new Map();
  const queue = packages.map(entryOf);
  const usedPackages = new Set(packages);
  while (queue.length) {
    const file = queue.pop();
    const target = path.join(vendorDir, path.relative(modules, file));
    if (out.has(target)) continue;
    const text = fs.readFileSync(file, 'utf8').replace(importPattern, (all, before, quote, specifier) => {
      if (specifier.startsWith('.')) {
        queue.push(path.join(path.dirname(file), specifier));
        return all;
      }
      const pkg = packageOf(specifier);
      if (specifier !== pkg) throw new Error(`${file} imports ${specifier}: a part of a package, not handled`);
      usedPackages.add(pkg);
      const entry = entryOf(pkg);
      queue.push(entry);
      return `${before}${quote}${urlOf(entry)}${quote}`;
    });
    out.set(target, text);
  }
  // Each package's licence goes along with its files.
  for (const pkg of usedPackages) {
    const licence = fs.readdirSync(path.join(modules, pkg)).find((name) => /^licen[cs]e/i.test(name));
    if (!licence) throw new Error(`${pkg} has no licence file`);
    out.set(path.join(vendorDir, pkg, licence), fs.readFileSync(path.join(modules, pkg, licence), 'utf8'));
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

// The URL the page imports a package from.
export function vendorUrl(pkg) {
  return urlOf(entryOf(pkg));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = vendorFiles();
  fs.rmSync(vendorDir, { recursive: true, force: true });
  for (const [file, text] of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const bytes = [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  console.log(`public/vendor/: ${files.size} files, ${Math.round(bytes / 1024)} KB`);
  for (const pkg of packages) console.log(`  ${pkg}  ${vendorUrl(pkg)}`);
}
