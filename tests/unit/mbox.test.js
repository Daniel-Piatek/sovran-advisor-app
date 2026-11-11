// Reading a mailbox file (mbox.js, advanced/mail/2): splitting a file into messages as it streams, and reading
// one message into its parts. Plain text in, plain data out: no file and no database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MboxSplitter, parseMessage, parseAddresses, parseLabels, decodeWords, decodeQuotedPrintable, htmlToText, parseDate, labelKind, plainSubject,
} from '../../mbox.js';

const split = (text, size = 1_000_000) => {
  const out = [];
  const splitter = new MboxSplitter((m) => out.push(m));
  const buffer = Buffer.from(text, 'utf8');
  for (let i = 0; i < buffer.length; i += size) splitter.push(buffer.subarray(i, i + size));
  splitter.end();
  return out;
};

const FILE = [
  'From 1700000000000000001@xxx Mon Nov 09 10:00:00 +0000 2026', 'Subject: One', '', 'First body', '>From a quoted line', '',
  'From 1700000000000000002@xxx Mon Nov 09 11:00:00 +0000 2026', 'Subject: Two', '', 'Second body', 'From here on it is only text', '',
].join('\n');

test('a file is split at its From lines, whatever the size of the pieces it arrives in', () => {
  for (const size of [1, 2, 7, 64, 1_000_000]) {
    const messages = split(FILE, size);
    assert.equal(messages.length, 2, `pieces of ${size} bytes`);
    assert.equal(messages[0].fromLine, 'From 1700000000000000001@xxx Mon Nov 09 10:00:00 +0000 2026');
    assert.equal(messages[0].raw, 'Subject: One\n\nFirst body\n>From a quoted line');
    // "From here on..." is not a date line, so it stays in the text
    assert.equal(messages[1].raw, 'Subject: Two\n\nSecond body\nFrom here on it is only text');
  }
});

test('lines with CRLF, no final newline, and text before the first message', () => {
  const messages = split('junk before\r\nFrom 17@xxx Tue Mar 09 12:00:00 +0000 2021\r\nSubject: A\r\n\r\nBody\r\n\r\nFrom 18@xxx Tue Mar 09 13:00:00 +0000 2021\r\nSubject: B\r\n\r\nLast line without a newline');
  assert.deepEqual(messages.map((m) => parseMessage(m.raw, m.fromLine).subject), ['A', 'B']);
  assert.equal(parseMessage(messages[1].raw).text, 'Last line without a newline');
  assert.equal(split('').length, 0);
  assert.equal(split('not a mailbox at all\n').length, 0);
});

test('words in headers: B and Q encodings, character sets, and joined neighbours', () => {
  assert.equal(decodeWords('=?UTF-8?B?RWluZ2VsYWRlbjogR2FydGVuZmVzdA==?='), 'Eingeladen: Gartenfest');
  assert.equal(decodeWords('=?UTF-8?Q?Zo=C3=AB_Dubois?='), 'Zoë Dubois');
  assert.equal(decodeWords('=?ISO-8859-1?Q?Caf=E9_Cr=E8me?='), 'Café Crème');
  assert.equal(decodeWords('=?UTF-8?B?SGVsbG8g?= =?UTF-8?B?V29ybGQ=?='), 'Hello World'); // the space between two encoded words is not text
  assert.equal(decodeWords('Plain and =?UTF-8?Q?encoded_?=words'), 'Plain and encoded words');
  assert.equal(decodeWords('=?x-unknown-set?Q?abc?='), 'abc');
  assert.equal(decodeWords(''), '');
  assert.equal(decodeWords(undefined), '');
});

test('quoted-printable text: soft line breaks, hex, and a stray equals sign', () => {
  assert.equal(decodeQuotedPrintable('a=3Db soft=\nbreak caf=C3=A9 and =ZZ here').toString('utf8'), 'a=b softbreak café and =ZZ here');
});

test('addresses: names, quotes, commas in names, encoded names, bare addresses, comments and groups', () => {
  assert.deepEqual(parseAddresses('Lena Fischer <Lena@Nordlicht.example>, jonas@hafen.example'), [
    { name: 'Lena Fischer', email: 'lena@nordlicht.example' }, { name: '', email: 'jonas@hafen.example' }]);
  assert.deepEqual(parseAddresses('"Fischer, Lena" <lena@nordlicht.example>; "O\'Neil" <on@x.example>'), [
    { name: 'Fischer, Lena', email: 'lena@nordlicht.example' }, { name: "O'Neil", email: 'on@x.example' }]);
  assert.deepEqual(parseAddresses('=?UTF-8?Q?Zo=C3=AB?= <zoe@example.org>'), [{ name: 'Zoë', email: 'zoe@example.org' }]);
  assert.deepEqual(parseAddresses('bob@example.com (Bob Builder)'), [{ name: 'Bob Builder', email: 'bob@example.com' }]);
  assert.deepEqual(parseAddresses('undisclosed-recipients:;'), []);
  assert.deepEqual(parseAddresses('<only@example.com>'), [{ name: '', email: 'only@example.com' }]);
  assert.deepEqual(parseAddresses('same@example.com <same@example.com>'), [{ name: '', email: 'same@example.com' }]);
  assert.deepEqual(parseAddresses(''), []);
});

test('labels: Gmail writes them in one header, with quotes round a label that holds a comma', () => {
  assert.deepEqual(parseLabels('Inbox,Important,"Clients, big",Category Updates'), ['Inbox', 'Important', 'Clients, big', 'Category Updates']);
  assert.deepEqual(parseLabels('=?UTF-8?Q?Familie_&_Freunde?=,Inbox,Inbox'), ['Familie & Freunde', 'Inbox']);
  assert.deepEqual(parseLabels(''), []);
  assert.deepEqual(['Inbox', 'Category Promotions', 'Finance'].map(labelKind), ['system', 'category', 'user']);
});

test('dates: the Date header, the From line when it is missing or broken, and nothing absurd', () => {
  assert.equal(parseDate('Tue, 03 Jan 2023 10:00:00 -0800 (PST)'), '2023-01-03T18:00:00.000Z');
  assert.equal(parseDate('garbage', 'Tue Mar 09 12:00:00 +0000 2021'), '2021-03-09T12:00:00.000Z');
  assert.equal(parseDate('Mon, 01 Jan 1900 00:00:00 +0000'), null);
  assert.equal(parseDate('', ''), null);
});

test('html to text: tags, entities, line breaks, and style left out', () => {
  assert.equal(htmlToText('<style>p{color:red}</style><h1>Hi</h1><p>Fish &amp; chips, caf&eacute; &#8364;5 &#x41;</p><p>Two<br>lines</p>'), 'Hi\nFish & chips, café €5 A\nTwo\nlines');
});

test('subjects lose their Re: and Fwd: for the conversation', () => {
  assert.equal(plainSubject('Re: RE: Fwd: AW: Plan'), 'Plan');
  assert.equal(plainSubject('Regarding the plan'), 'Regarding the plan');
});

const message = (headers, body) => `${headers.join('\n')}\n\n${body}`;

test('a message: sender, recipients, date, subject, Gmail ids and labels', () => {
  const m = parseMessage(message([
    'X-GM-THRID: 1700000000000009001', 'X-Gmail-Labels: Inbox,Projects', 'Message-ID: <abc@x.example>', 'In-Reply-To: <prev@x.example>', 'References: <first@x.example> <prev@x.example>',
    'Date: Mon, 09 Nov 2026 10:00:00 +0000', 'From: Lena Fischer <lena@nordlicht.example>', 'To: Me <me@example.com>,', ' jonas@hafen.example', 'Cc: mara@example.com',
    'Subject: =?UTF-8?B?UmU6IEVpbmxhZHVuZw==?=',
  ], 'Hello.'), 'From 1700000000000000042@xxx Mon Nov 09 10:00:00 +0000 2026');
  assert.equal(m.gmailId, BigInt('1700000000000000042').toString(16));
  assert.equal(m.gmailThreadId, BigInt('1700000000000009001').toString(16));
  assert.deepEqual([m.messageId, m.inReplyTo, m.references], ['abc@x.example', 'prev@x.example', ['first@x.example', 'prev@x.example']]);
  assert.deepEqual(m.from, { name: 'Lena Fischer', email: 'lena@nordlicht.example' });
  assert.deepEqual(m.to.map((a) => a.email), ['me@example.com', 'jonas@hafen.example']);
  assert.deepEqual(m.cc, [{ name: '', email: 'mara@example.com' }]);
  assert.equal(m.sentAt, '2026-11-09T10:00:00.000Z');
  assert.equal(m.subject, 'Re: Einladung');
  assert.deepEqual(m.labels, ['Inbox', 'Projects']);
  assert.equal(m.text, 'Hello.');
});

test('the text: quoted-printable in UTF-8, in Latin-1, and base64', () => {
  const qp = parseMessage(message(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'], 'Gr=C3=BC=C3=9Fe aus K=C3=B6ln=\n!'));
  assert.equal(qp.text, 'Grüße aus Köln!');
  const latin = parseMessage(message(['Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable'], 'Caf=E9 cr=E8me'));
  assert.equal(latin.text, 'Café crème');
  const b64 = parseMessage(message(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'], Buffer.from('Zoë says hi ✓').toString('base64')));
  assert.equal(b64.text, 'Zoë says hi ✓');
  const eightBit = parseMessage(Buffer.from(message(['Content-Type: text/plain; charset=utf-8'], 'Plain 8-bit: Zoë ✓'), 'utf8').toString('latin1'));
  assert.equal(eightBit.text, 'Plain 8-bit: Zoë ✓');
  const none = parseMessage(message(['Subject: no type'], 'Just words'));
  assert.equal(none.text, 'Just words');
});

test('a text and an html version: the text is kept, and html alone is turned into text', () => {
  const both = parseMessage(message(['Content-Type: multipart/alternative; boundary="b1"'],
    '--b1\nContent-Type: text/plain\n\nThe plain one\n--b1\nContent-Type: text/html\n\n<p>The <b>html</b> one</p>\n--b1--'));
  assert.equal(both.text, 'The plain one');
  const htmlOnly = parseMessage(message(['Content-Type: text/html; charset=utf-8'], '<p>Only <i>html</i> &amp; more</p>'));
  assert.equal(htmlOnly.text, 'Only html & more');
  const reversed = parseMessage(message(['Content-Type: multipart/alternative; boundary=b2'], '--b2\nContent-Type: text/html\n\n<p>html</p>\n--b2\nContent-Type: text/plain\n\nplain\n--b2--'));
  assert.equal(reversed.text, 'plain');
});

test('attachments: only their names are kept; nested parts, odd names and forwarded mail', () => {
  const m = parseMessage(message(['Content-Type: multipart/mixed; boundary="mix"'], [
    '--mix', 'Content-Type: multipart/alternative; boundary="alt"', '', '--alt', 'Content-Type: text/plain', '', 'See attached.', '--alt', 'Content-Type: text/html', '', '<p>See attached.</p>', '--alt--',
    '--mix', 'Content-Type: application/pdf; name="plan.pdf"', 'Content-Disposition: attachment; filename="plan.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQ=',
    '--mix', "Content-Type: image/png", "Content-Disposition: attachment; filename*=utf-8''Gr%C3%BCn%20Bild.png", '', 'AAAA',
    '--mix', 'Content-Type: image/png', 'Content-ID: <inline1>', '', 'AAAA',
    '--mix', 'Content-Type: message/rfc822', '', 'Subject: forwarded', '',
    '--mix--'].join('\n')));
  assert.equal(m.text, 'See attached.');
  assert.deepEqual(m.attachments, ['plan.pdf', 'Grün Bild.png', 'Forwarded message']);
});

test('no date header falls back to the From line; a message with nothing is still a message', () => {
  const m = parseMessage('Subject: Hi\n\nBody', 'From 99@xxx Tue Mar 09 12:00:00 +0000 2021');
  assert.equal(m.sentAt, '2021-03-09T12:00:00.000Z');
  const empty = parseMessage('');
  assert.deepEqual([empty.subject, empty.text, empty.sentAt, empty.from.email, empty.labels, empty.attachments], ['', '', null, '', [], []]);
  const odd = parseMessage(message(['Content-Type: multipart/mixed; boundary="never-closed"'], '--never-closed\nContent-Type: text/plain\n\nStill read'));
  assert.equal(odd.text, 'Still read');
});

test('the snippet leaves quoted replies out and stays short', () => {
  const m = parseMessage(message(['Subject: x'], `Thanks, yes.\n\n> On Monday you wrote:\n> something old\n${'word '.repeat(100)}`));
  assert.ok(m.snippet.startsWith('Thanks, yes. word word'));
  assert.ok(!m.snippet.includes('something old'));
  assert.ok(m.snippet.length <= 200);
});
