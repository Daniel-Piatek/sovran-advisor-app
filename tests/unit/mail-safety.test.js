// Reading a mail safely (public/mail-safety.js, Mail 7): the checks on a mail's own html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { importMboxText, getThread, listThreads, setImagesOk, listSenders, imagesOk } from '../../mail.js';
import { startServer } from '../../server.js';
import { framePolicy, findLinks, suspiciousLinks, remoteImages, hostOf } from '../../public/mail-safety.js';
import { makeMailbox } from '../../scripts/demo-mail.js';

test('the policy a mail is shown under: nothing from the network, images only when allowed', () => {
  assert.equal(framePolicy(false), "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  assert.equal(framePolicy(true), "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:");
  assert.ok(!/script-src|connect-src/.test(framePolicy(true)), 'no script and no connection is allowed, by default-src none');
});

test('a link that says one address and goes to another is marked; an honest one is not', () => {
  const html = `<p><a href="https://click.mailer-track.io/x?u=1">Read it on deepwork.news</a>
    <a href="https://www.deepwork.news/post">deepwork.news</a> <a href="https://blog.deepwork.news/a">https://deepwork.news/a</a>
    <a href='https://evil.example/login'>https://paypal.com/signin</a> <a href="mailto:a@b.example">a@b.example</a> <a href="https://x.example/">Click here</a>
    <a href="https://example.com/&amp;q=1"><b>example.com</b></a></p>`;
  assert.equal(findLinks(html).length, 6, 'mailto is not a web link');
  assert.deepEqual(suspiciousLinks(html).map((l) => [l.shown, l.goesTo]), [['deepwork.news', 'click.mailer-track.io'], ['paypal.com', 'evil.example']]);
  assert.deepEqual(suspiciousLinks('<a href="https://a.example">no address in these words</a>'), []);
  assert.equal(hostOf('https://WWW.Example.com/x'), 'example.com');
  assert.equal(hostOf('not a url at all'), '');
});

test('the images a mail would fetch: how many, and from where', () => {
  const html = '<img src="https://images.newsletter.example/a.png"><IMG alt=x SRC=\'//cdn.example/b.gif\'><img src="data:image/png;base64,AAAA"><div style="background:url(https://bg.example/c.jpg)"></div>';
  assert.deepEqual(remoteImages(html), { count: 3, hosts: ['images.newsletter.example', 'cdn.example', 'bg.example'] });
  assert.deepEqual(remoteImages('<p>no images</p>'), { count: 0, hosts: [] });
});

test('a mail keeps its own html, and reading the same file again fills it in for a mail read before', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const { text } = makeMailbox({ filler: 0 });
  importMboxText(db, text, { email: 'demo@example.com', filename: 'a.mbox' });
  const digest = getThread(db, listThreads(db, { q: 'ideas' })[0].id).messages[0];
  assert.match(digest.html, /^<html>.*<img src="https:\/\/images\.newsletter\.example\/hero\.png"/s);
  assert.equal(getThread(db, listThreads(db, { q: 'onboarding' })[0].id).messages[0].html, '', 'a mail with only text has no html');
  db.exec("UPDATE mail_messages SET body_html = ''"); // as a mail read before this lesson
  assert.equal(getThread(db, listThreads(db, { q: 'ideas' })[0].id).messages[0].html, '');
  const again = importMboxText(db, text, { email: 'demo@example.com', filename: 'b.mbox' });
  assert.deepEqual([again.added, again.already_here], [0, 8]);
  assert.match(getThread(db, listThreads(db, { q: 'ideas' })[0].id).messages[0].html, /deepwork\.news/);
});

test('the choice per sender: sealed until said, remembered for that sender only', async (t) => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  importMboxText(db, makeMailbox({ filler: 0 }).text, { email: 'demo@example.com', filename: 'a.mbox' });
  const sender = 'digest@newsletter.example';
  const digest = () => getThread(db, listThreads(db, { q: 'ideas' })[0].id).messages[0];
  assert.deepEqual([digest().images_ok, imagesOk(db, sender)], [false, false]);
  assert.deepEqual(setImagesOk(db, ' Digest@Newsletter.example ', true), { email: sender, load_images: true });
  assert.equal(digest().images_ok, true);
  assert.equal(getThread(db, listThreads(db, { q: 'invoice' })[0].id).messages[0].images_ok, false, 'another sender starts sealed again');
  setImagesOk(db, sender, false);
  assert.equal(digest().images_ok, false);
  assert.deepEqual(listSenders(db), [{ email: sender, load_images: false }]);
  assert.throws(() => setImagesOk(db, 'nobody', true), /address/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'senders-'));
  const app = await startServer({ port: 0, dataDir: dir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const put = (body) => fetch(`${app.url}/api/mail/senders`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put({ email: sender, load_images: true })).status, 200);
  assert.equal((await put({ email: sender, load_images: 'yes' })).status, 400);
  assert.equal((await put({ email: 'x', load_images: true })).status, 400);
  assert.deepEqual(await (await fetch(`${app.url}/api/mail/senders`)).json(), [{ email: sender, load_images: true }]);
  assert.equal((await fetch(`${app.url}/api/mail/senders`, { method: 'POST' })).status, 405);
});

import { cleanForFrame } from '../../public/mail-safety.js';

test('what goes into the frame: scripts and handlers out; remote images out while they are held back', () => {
  const html = '<p onclick="steal()">Hi</p><script>alert(1)</script><SCRIPT src="https://x.example/a.js"></SCRIPT><img src="https://images.newsletter.example/a.png" alt="a"><img src="data:image/png;base64,AAAA"><div style="background:url(https://bg.example/c.jpg)"></div><img srcset="https://a.example/x.png 2x" src="//cdn.example/b.gif">';
  const held = cleanForFrame(html);
  assert.ok(!/<script|onclick|alert|https:\/\/(images|bg|a)\.|cdn\.example/i.test(held), held);
  assert.ok(held.includes('src="data:image/png;base64,AAAA"'), 'a picture inside the mail itself stays');
  const allowed = cleanForFrame(html, { images: true });
  assert.ok(!/<script|onclick|alert/.test(allowed));
  assert.ok(allowed.includes('https://images.newsletter.example/a.png') && allowed.includes('url(https://bg.example/c.jpg)'), 'allowed images stay');
});
