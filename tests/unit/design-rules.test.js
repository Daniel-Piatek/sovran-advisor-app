// Design rule checks (the rules are in AGENTS.md, "Design rules").
// 1. No raw colour anywhere in the app's code outside public/tokens.css.
//    Raw colours are hex values (#1c1c1e), colour functions (rgb(), hsl(), oklch() ...)
//    and named colours (red, white ...). Use a variable from tokens.css instead.
// 2. Flat surfaces: no shadows and no gradients anywhere, tokens.css included.
// The one-accent rule is checked in the browser: tests/e2e/design-rules.spec.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tokensFile = path.join(root, 'public', 'tokens.css');

const namedColours = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue
  cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
  darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue
  darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
  dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray
  green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
  lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen
  lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
  lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
  mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip
  peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown
  salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow
  springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
  yellowgreen`.split(/\s+/));

const hex = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const colourFunction = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;

// Blank out comments but keep every character's position, so line numbers stay right.
const blank = (text) => text.replace(/[^\n]/g, ' ');
const stripBlockComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, blank);
const stripLineComments = (code) => code.replace(/(^|[^:])\/\/[^\n]*/g, (m, before) => before + blank(m.slice(before.length)));

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Raw colours in a piece of CSS. `offset` places it inside its file.
function cssColours(css, offset = 0) {
  const found = [];
  const code = stripBlockComments(css);
  for (const re of [hex, colourFunction]) {
    for (const m of code.matchAll(re)) found.push({ index: offset + m.index, value: m[0] });
  }
  // Named colours only count inside a declaration's value: `color: red`.
  for (const decl of code.matchAll(/:([^;{}]+)/g)) {
    for (const word of decl[1].matchAll(/[a-z]+/gi)) {
      if (namedColours.has(word[0].toLowerCase())) {
        found.push({ index: offset + decl.index + 1 + word.index, value: word[0] });
      }
    }
  }
  return found;
}

// Raw colours in JavaScript: colour functions, and strings that are a hex or named colour.
function jsColours(js, offset = 0) {
  const found = [];
  const code = stripLineComments(stripBlockComments(js));
  for (const m of code.matchAll(colourFunction)) found.push({ index: offset + m.index, value: m[0] });
  for (const m of code.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
    const value = m[2].trim();
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || namedColours.has(value.toLowerCase())) {
      found.push({ index: offset + m.index, value });
    }
  }
  return found;
}

// Raw colours in HTML: inside <style>, style="...", <script> and colour attributes.
function htmlColours(html) {
  const found = [];
  for (const m of html.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>/gi)) {
    found.push(...cssColours(m[2], m.index + m[1].length));
  }
  for (const m of html.matchAll(/(<script[^>]*>)([\s\S]*?)<\/script>/gi)) {
    found.push(...jsColours(m[2], m.index + m[1].length));
  }
  for (const m of html.matchAll(/(\sstyle=")([^"]*)"/gi)) {
    found.push(...cssColours(m[2], m.index + m[1].length));
  }
  for (const m of html.matchAll(/(\s(?:fill|stroke|color|bgcolor|stop-color)=")([^"]*)"/gi)) {
    const value = m[2].trim();
    if (value && !/^(?:none|currentcolor|transparent|inherit)$/i.test(value) && !value.startsWith('var(')) {
      found.push({ index: m.index + m[1].length, value });
    }
  }
  return found;
}

export function findRawColours(text, extension) {
  const found = extension === '.css' ? cssColours(text)
    : extension === '.html' || extension === '.svg' ? htmlColours(text)
    : extension === '.js' || extension === '.mjs' ? jsColours(text)
    : [];
  return found.sort((a, b) => a.index - b.index).map((f) => ({ line: lineOf(text, f.index), value: f.value }));
}

// Shadows and gradients in CSS: box-shadow or text-shadow set to anything but none,
// drop-shadow() and any *-gradient().
function cssShadows(css) {
  const found = [];
  const code = stripBlockComments(css);
  for (const m of code.matchAll(/\b(box-shadow|text-shadow)\s*:\s*([^;}]*)/gi)) {
    if (!/^\s*(?:none|initial|unset)\s*$/i.test(m[2])) found.push({ index: m.index, value: m[1] });
  }
  for (const m of code.matchAll(/\b(?:drop-shadow|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/gi)) {
    found.push({ index: m.index, value: m[0] });
  }
  return found;
}

export function findShadowsAndGradients(text, extension) {
  let found = [];
  if (extension === '.css') found = cssShadows(text);
  if (extension === '.html' || extension === '.svg') {
    for (const m of text.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>|(\sstyle=")([^"]*)"/gi)) {
      const [prefix, css] = m[1] ? [m[1], m[2]] : [m[3], m[4]];
      found.push(...cssShadows(css).map((f) => ({ ...f, index: f.index + m.index + prefix.length })));
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => ({ line: lineOf(text, f.index), value: f.value }));
}

// The app's code: everything in public/, design/ and scripts/, and the server files at
// the top level. Not public/icons/: `npm run icons` makes those from design/icon.svg and
// the tokens, and a test checks they still match. Not public/vendor/: the editor's
// building blocks, copied as they are by `npm run vendor` (they hold no styles).
const generatedIcons = path.join(root, 'public', 'icons');
const vendored = path.join(root, 'public', 'vendor');

function appFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (full === generatedIcons || full === vendored) continue;
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  for (const dir of ['public', 'design', 'scripts']) walk(path.join(root, dir));
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith('.js') && name !== 'playwright.config.js') files.push(path.join(root, name));
  }
  return files;
}

const appFilesWithoutTokens = () => appFiles().filter((f) => f !== tokensFile);

test('finds raw colours of every kind', () => {
  const css = `a { color: #1c1c1e; background: rgb(0 0 0); border-color: RED; }
    b { outline: 1px solid oklch(70% 0.1 200); box-shadow: 0 0 2px hsla(0, 0%, 0%, .2); }`;
  assert.deepEqual(findRawColours(css, '.css').map((f) => f.value),
    ['#1c1c1e', 'rgb(', 'RED', 'oklch(', 'hsla(']);

  assert.deepEqual(findRawColours(`el.style.color = 'white'; el.style.fill = "#abc";`, '.js').map((f) => f.value),
    ['white', '#abc']);

  const html = `<div style="color: #fff">x</div><svg><path fill="tomato"/></svg>
    <style>p { color: black; }</style>`;
  assert.deepEqual(findRawColours(html, '.html').map((f) => f.value), ['#fff', 'tomato', 'black']);
});

test('lets variables, keywords, comments, links and prose through', () => {
  const css = `/* #ffffff white rgb(1,2,3) */
    a { color: var(--color-text); background: transparent; border-color: currentColor; }
    a:hover { color: var(--color-accent); }`;
  assert.deepEqual(findRawColours(css, '.css'), []);

  const html = `<a href="#add">A red letter day</a><p>Black and white</p><path fill="currentColor"/>`;
  assert.deepEqual(findRawColours(html, '.html'), []);

  assert.deepEqual(findRawColours(`// set it to red\nconst id = '#add-note';`, '.js'), []);
});

test('reports the line of a raw colour', () => {
  assert.deepEqual(findRawColours('a {\n  color: var(--x);\n  background: #123456;\n}', '.css'),
    [{ line: 3, value: '#123456' }]);
});

test('no raw colour in the app outside tokens.css', () => {
  const problems = [];
  for (const file of appFilesWithoutTokens()) {
    for (const f of findRawColours(fs.readFileSync(file, 'utf8'), path.extname(file))) {
      problems.push(`${path.relative(root, file)}:${f.line}: ${f.value}  (use a variable from public/tokens.css)`);
    }
  }
  assert.deepEqual(problems, []);
});

test('tokens.css uses neither pure black nor pure white', () => {
  const tokens = stripBlockComments(fs.readFileSync(tokensFile, 'utf8'));
  const pure = [...tokens.matchAll(/--[\w-]+:\s*(#0{3}(?:0{3})?|#f{3}(?:f{3})?|black|white)\s*;/gi)].map((m) => m[0]);
  assert.deepEqual(pure, []);
});

test('every variable the app uses is defined in tokens.css', () => {
  const defined = new Set([...fs.readFileSync(tokensFile, 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const missing = [];
  for (const file of appFiles()) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/var\((--[\w-]+)/g)) {
      if (!defined.has(m[1])) missing.push(`${path.relative(root, file)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('finds shadows and gradients', () => {
  const css = `a { box-shadow: 0 1px 2px var(--x); }
    b { text-shadow: 1px 1px var(--x); filter: drop-shadow(0 0 2px var(--x)); }
    c { background: linear-gradient(var(--a), var(--b)); }`;
  assert.deepEqual(findShadowsAndGradients(css, '.css').map((f) => f.value),
    ['box-shadow', 'text-shadow', 'drop-shadow(', 'linear-gradient(']);
  assert.deepEqual(findShadowsAndGradients('<div style="box-shadow: 0 0 4px var(--x)"></div>', '.html'),
    [{ line: 1, value: 'box-shadow' }]);
});

test('lets flat styles through', () => {
  const css = `/* box-shadow: 0 0 4px */ a { box-shadow: none; border-bottom: var(--line); }`;
  assert.deepEqual(findShadowsAndGradients(css, '.css'), []);
});

test('no shadow or gradient anywhere in the app', () => {
  const problems = [];
  for (const file of appFiles()) {
    for (const f of findShadowsAndGradients(fs.readFileSync(file, 'utf8'), path.extname(file))) {
      problems.push(`${path.relative(root, file)}:${f.line}: ${f.value}  (surfaces are flat: use var(--line))`);
    }
  }
  assert.deepEqual(problems, []);
});
