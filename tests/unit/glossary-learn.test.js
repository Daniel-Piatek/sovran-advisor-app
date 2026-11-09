// Learning from a correction (public/glossary-learn.js): when a fix is proposed, and when never.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeFix, regionOf, applyFixes } from '../../public/glossary-learn.js';

test('one to three words changed inside the dictated words is a fix to propose', () => {
  assert.deepEqual(proposeFix('We met North light about the workshop.', 'We met Nordlicht about the workshop.'), { heard_as: 'North light', term: 'Nordlicht' });
  assert.deepEqual(proposeFix('Call lena fisher tomorrow', 'Call Lena Fischer tomorrow'), { heard_as: 'lena fisher', term: 'Lena Fischer' });
  assert.deepEqual(proposeFix('nordlicht is booked', 'Nordlicht is booked'), { heard_as: 'nordlicht', term: 'Nordlicht' }, 'a case fix is a fix');
  assert.deepEqual(proposeFix('Nordlicht', 'North light'), { heard_as: 'Nordlicht', term: 'North light' }, 'a one-word dictation too');
  assert.deepEqual(proposeFix('met North light, then lunch', 'met Nordlicht, then lunch'), { heard_as: 'North light', term: 'Nordlicht' }, 'punctuation stays out of it');
});

test('never a number, a link, an address, a rewritten sentence, or no change at all', () => {
  assert.equal(proposeFix('Pay 120 euros today', 'Pay 130 euros today'), null);
  assert.equal(proposeFix('See example dot com now', 'See https://example.com now'), null);
  assert.equal(proposeFix('Write to lena at x dot de', 'Write to lena@x.de'), null);
  assert.equal(proposeFix('We met North light about the workshop in the morning.', 'Then we all went for coffee instead of the workshop.'), null, 'a sentence rewritten');
  assert.equal(proposeFix('one two three four five', 'one two three four five six seven eight nine'), null, 'only added words');
  assert.equal(proposeFix('Hello there.', 'Hello there'), null, 'only punctuation');
  assert.equal(proposeFix('Hello there', 'Hello there'), null);
  assert.equal(proposeFix('We met North light about it', 'We met about it'), null, 'only removed words');
});

test('the dictated words are found between what stood before and after them', () => {
  const text = 'Met Lena in the morning. North light is booked. See you.';
  assert.equal(regionOf(text, 'Met Lena in the morning.', ' See you.'), ' North light is booked.');
  assert.equal(regionOf('Start North light', '', ''), 'Start North light');
  assert.equal(regionOf('abc', 'zzz', ''), null);
  assert.equal(regionOf('abc def', 'abc', 'zzz'), null);
});

test('fixes apply to whole words in any case', () => {
  assert.deepEqual(applyFixes('met north light today', [{ heard_as: 'North light', term: 'Nordlicht' }]), { text: 'met Nordlicht today', fixed: 1 });
});
