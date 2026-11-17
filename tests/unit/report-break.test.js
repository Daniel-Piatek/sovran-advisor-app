// A report's break line (public/report-break.js, 2026-11-17, the owner's wish): <div class="break"></div> in any spelling
// becomes the gold bar on the page and a plain * * * for the assistant; it is never left as text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markBreaks, plainBreaks } from '../../public/report-break.js';

const SPELLINGS = [
  '<div class="break"></div>',
  "<div class='break'></div>",
  '<div class=break></div>',
  '<div class="break" />',
  '<DIV CLASS="break"></DIV>',
  '&lt;div class=&quot;break&quot;&gt;&lt;/div&gt;',
  '&lt;div class="break"&gt;&lt;/div&gt;',
  '&#60;div class=&#34;break&#34;&#62;&#60;/div&#62;',
  '\\<div class="break"\\>\\</div\\>',
];

test('every spelling of the break line becomes a rule for the assistant and a mark of its own for the page', () => {
  for (const line of SPELLINGS) {
    const plain = plainBreaks(`Before.\n${line}\nAfter.`);
    assert.equal(plain, 'Before.\n\n\n* * *\n\n\nAfter.', line);
    assert.doesNotMatch(plain, /div|break/i, line);
    assert.match(markBreaks(`Before.\n\n${line}\n\nAfter.`), /\n\nSOVRAN-REPORT-BREAK\n\n/, line);
  }
});

test('other words are left alone', () => {
  for (const text of ['A break in the day.', '<div class="breaks"></div>', 'class="break"', '']) assert.equal(plainBreaks(text), text);
  assert.equal(plainBreaks(null), '');
});
