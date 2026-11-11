// A made-up mailbox in the shape Google Takeout writes it (one .mbox file), for the demo copy and the tests.
// Everything is invented: no real person, address or mail. It uses the ways real mail is written on purpose
// (quoted-printable, base64, a text and an html version, an attachment, an encoded subject), so reading it
// exercises the same code a real export does. Plain ASCII, so it is the same bytes in any encoding.

const ME = 'demo@example.com';
const ID0 = 1_700_000_000_000_000_000n; // Google writes a message's number in decimal

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const rfcDate = (d) => `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
const ctime = (d) => `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
const b64 = (text) => Buffer.from(text).toString('base64').replace(/(.{76})/g, '$1\n');

// One message. body: { plain?, html?, qp?, base64?, attachment? }
function message({ n, thread, at, from, to, cc = '', subject, labels, replyTo = null, body, headers = [] }) {
  const messageId = `<m${n}@demo.example>`;
  const lines = [
    `From ${ID0 + BigInt(n)}@xxx ${ctime(at)}`,
    `X-GM-THRID: ${ID0 + BigInt(thread)}`,
    `X-Gmail-Labels: ${labels.join(',')}`,
    `Message-ID: ${messageId}`,
    ...(replyTo ? [`In-Reply-To: <m${replyTo}@demo.example>`, `References: <m${replyTo}@demo.example>`] : []),
    `Date: ${rfcDate(at)}`,
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${subject}`,
    ...headers,
    'MIME-Version: 1.0',
  ];
  const { plain = '', html = '', qp = false, base64 = false, attachment = null, calendar = '' } = body;
  const textPart = (type, text) => (qp
    ? [`Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: quoted-printable', '', text]
    : base64
      ? [`Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', b64(text)]
      : [`Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: 7bit', '', text]);
  const alternative = (boundary) => [`Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, ...textPart('text/plain', plain), `--${boundary}`, ...textPart('text/html', html), `--${boundary}--`];
  const withCalendar = () => ['Content-Type: multipart/alternative; boundary="cal"', '', '--cal', ...textPart('text/plain', plain),
    '--cal', 'Content-Type: text/calendar; method=REQUEST; charset="UTF-8"', 'Content-Transfer-Encoding: 7bit', '', calendar, '--cal--'];
  if (attachment) {
    lines.push('Content-Type: multipart/mixed; boundary="mix"', '', '--mix',
      ...(html ? alternative('alt') : textPart('text/plain', plain)),
      '--mix', `Content-Type: ${attachment.type}; name="${attachment.name}"`, `Content-Disposition: attachment; filename="${attachment.name}"`,
      'Content-Transfer-Encoding: base64', '', b64('%PDF-1.4 a made-up file'), '--mix--');
  } else if (calendar) lines.push(...withCalendar());
  else if (html && plain) lines.push(...alternative('alt'));
  else if (html) lines.push(...textPart('text/html', html));
  else lines.push(...textPart('text/plain', plain));
  return `${lines.join('\n')}\n`;
}

// The five conversations the lesson names, then `filler` more messages spread over nine labels.
// today: a day, YYYY-MM-DD, that the newest messages are near.
export function makeMailbox({ filler = 1276, today = '2026-11-09' } = {}) {
  const end = new Date(`${today}T09:00:00Z`);
  const at = (daysAgo, hour = 9) => new Date(end.getTime() - daysAgo * 86_400_000 + (hour - 9) * 3_600_000);
  const out = [];
  let n = 1;
  const thread = (id) => 9_000 + id;

  // Lena's onboarding reply: three messages, one conversation (quoted-printable, a text and an html version).
  out.push(message({ n: n++, thread: thread(1), at: at(6, 10), from: `Demo Owner <${ME}>`, to: 'Lena Fischer <lena@nordlicht.example>', subject: 'Onboarding call on Thursday?',
    labels: ['Sent', 'Projects'], body: { plain: 'Hi Lena, can we talk through the course visuals on Thursday? Ten minutes is enough.' } }));
  out.push(message({ n: n++, thread: thread(1), at: at(5, 15), from: 'Lena Fischer <lena@nordlicht.example>', to: ME, subject: 'Re: Onboarding call on Thursday?', replyTo: 1,
    labels: ['Inbox', 'Important', 'Projects'], body: { qp: true, plain: 'Thursday works. I will send the drafts before - the new palette is nice, I think you will like it.=0A=0ALena', html: '<p>Thursday works. I will send the drafts before &mdash; the new palette is nice, I think you will like it.</p><p>Lena</p>' } }));
  out.push(message({ n: n++, thread: thread(1), at: at(5, 17), from: `Demo Owner <${ME}>`, to: 'Lena Fischer <lena@nordlicht.example>', subject: 'Re: Onboarding call on Thursday?', replyTo: 2,
    labels: ['Sent', 'Projects'], body: { plain: 'Perfect, see you Thursday at 10.' } }));

  // Jonas's brief: two messages, the first with an attachment.
  out.push(message({ n: n++, thread: thread(2), at: at(9, 11), from: 'Jonas Weber <jonas@hafenkante.example>', to: ME, cc: 'Mara Klein <mara@example.com>', subject: 'Brief for the launch event',
    labels: ['Inbox', 'Projects'], body: { plain: 'Hello, here is the brief for the launch event at the harbour. Please read page two first.', attachment: { type: 'application/pdf', name: 'launch-brief.pdf' } } }));
  out.push(message({ n: n++, thread: thread(2), at: at(8, 9), from: `Demo Owner <${ME}>`, to: 'Jonas Weber <jonas@hafenkante.example>', subject: 'Re: Brief for the launch event', replyTo: 4,
    labels: ['Sent', 'Projects'], body: { plain: 'Thank you Jonas. Read it; two questions about the dates, I will call you.' } }));

  // An invoice: base64 text and a PDF.
  out.push(message({ n: n++, thread: thread(3), at: at(12, 8), from: 'Billing <billing@printshop.example>', to: ME, subject: 'Invoice 2026-114',
    labels: ['Inbox', 'Starred', 'Finance'], body: { base64: true, plain: 'Your invoice 2026-114 for 120.00 EUR is attached. Payable within 14 days.', attachment: { type: 'application/pdf', name: 'invoice-2026-114.pdf' } } }));

  // A newsletter: html only, with entities.
  out.push(message({ n: n++, thread: thread(4), at: at(2, 7), from: 'Weekly Digest <digest@newsletter.example>', to: ME, subject: 'This week: 5 ideas and a question',
    headers: ['List-Unsubscribe: <https://newsletter.example/unsubscribe/1>'], labels: ['Inbox', 'Category Promotions', 'Newsletters'], body: { html: '<html><head><style>p{color:red}</style></head><body><h1>Five ideas</h1><img src="https://images.newsletter.example/hero.png" alt="hero"><p>Fish &amp; chips, caf&eacute; notes and a question: what did you ship?</p><img src="https://images.newsletter.example/two.png" alt="two"><p><a href="https://click.mailer-track.io/x?u=1">Read it on deepwork.news</a></p><p>Read more</p></body></html>' } }));

  // An invitation with an encoded subject and name.
  out.push(message({ n: n++, thread: thread(5), at: at(1, 12), from: '=?UTF-8?Q?Zo=C3=AB_Dubois?= <zoe@example.org>', to: ME, subject: '=?UTF-8?B?RWluZ2VsYWRlbjogR2FydGVuZmVzdCDwn4yf?=',
    labels: ['Inbox', 'Events'], body: { plain: 'You are invited to our garden party on Saturday at 15:00. Bring a friend.', calendar: `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:garden-party-2026@example.org\nSEQUENCE:0\nSUMMARY:Garden party\nDTSTART:20261114T150000\nDTEND:20261114T180000\nLOCATION:Zoe's garden\nORGANIZER;CN=Zoe Dubois:mailto:zoe@example.org\nATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${ME}\nEND:VEVENT\nEND:VCALENDAR` } }));

  // The rest: made-up people writing about made-up things, three to a conversation, over the nine labels.
  const people = ['Ada Brandt', 'Ben Okafor', 'Chloe Park', 'Dario Rossi', 'Eva Lindgren', 'Farid Haddad', 'Greta Novak', 'Hugo Martins'];
  const topics = ['the schedule', 'next week', 'a question about the draft', 'the budget', 'travel plans', 'the workshop', 'feedback', 'a quick favour', 'the new plan'];
  const kinds = [['Inbox'], ['Inbox', 'Projects'], ['Inbox', 'Finance'], ['Inbox', 'Events'], ['Inbox', 'Category Promotions', 'Newsletters'], ['Inbox', 'Important'], ['Inbox', 'Starred'], ['Sent', 'Projects']];
  for (let i = 0; i < filler; i++) {
    const who = people[i % people.length];
    const labels = kinds[i % kinds.length];
    const sent = labels[0] === 'Sent';
    const handle = who.toLowerCase().replace(/\W+/g, '.');
    const group = Math.floor(i / 3);
    const first = n;
    const day = 14 + Math.floor(i * 1.3);
    out.push(message({
      n: n++, thread: thread(100 + group), at: at(day, 8 + (i % 9)), from: sent ? `Demo Owner <${ME}>` : `${who} <${handle}@example.net>`,
      to: sent ? `${who} <${handle}@example.net>` : ME, subject: `${i % 3 ? 'Re: ' : ''}About ${topics[group % topics.length]}`,
      replyTo: i % 3 ? first - 1 : null, labels, headers: labels.includes('Newsletters') ? ['List-Unsubscribe: <https://newsletter.example/unsubscribe/2>'] : [],
      body: { plain: `Hello, a few words about ${topics[group % topics.length]} (message ${i + 1}). Let me know what you think.` },
    }));
  }
  return { text: out.join('\n'), total: n - 1 };
}
