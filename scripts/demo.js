// Fills a demo copy of the app with made-up data of every kind, around today, so the app
// can be tried out full without touching the real one:
//   npm run demo                      fills demo-data/ (made again from nothing each time)
//   npm run demo:start                runs it at http://127.0.0.1:3100
// It never writes into the real data/ folder. Everything goes in through the app's own code.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db.js';
import { createNote, updateNote } from '../notes.js';
import { createEntry, createJournal, localDay } from '../entries.js';
import { createTask, changeTask } from '../tasks.js';
import { createEvent } from '../events.js';
import { createPerson, createCompany } from '../people.js';
import { createLifeItem } from '../life.js';
import { createCapture } from '../captures.js';
import { addCalendar, setOwnColour } from '../calendars.js';
import { addDays, weekOf, setHighlight, createBlock } from '../planner.js';
import { closeDay, closeWeek } from '../reviews.js';
import { listBlocks, setFolded, searchBullets } from '../blocks.js';
import { createComment, replyTo } from '../comments.js';
import { createBoard, addItem } from '../boards.js';
import { importObsidian, importDayOne } from '../import-notes.js';
import { addStroke } from '../ink.js';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEMO_DIR = path.join(appDir, 'demo-data');

// dataDir: where files are kept (the mail's attachments); without it only their names are.
export function fillDemo(db, today = localDay(), { dataDir = null } = {}) {
  const day = (n) => addDays(today, n);
  const monday = weekOf(today);
  const link = (title, kind, id) => `[${title}](/${kind}/${id})`;

  // ---- My Life ----
  const health = createLifeItem(db, { kind: 'key_element', title: 'Health', description: 'Body, energy and sleep', not_this: 'Not a diet; how I feel' });
  const work = createLifeItem(db, { kind: 'key_element', title: 'Work', description: 'The craft, the course and the clients', not_this: 'Not every request that comes in' });
  const family = createLifeItem(db, { kind: 'key_element', title: 'Family', description: 'The people at home and the home itself' });
  const money = createLifeItem(db, { kind: 'key_element', title: 'Finances', description: 'Enough, and in order' });
  const half = createLifeItem(db, { kind: 'goal', title: 'Run a half marathon', home_id: health.id, horizon: 'quarter', statement: 'Finish the city half in under two hours', shipped_means: 'A finish time under 2:00' });
  const course = createLifeItem(db, { kind: 'goal', title: 'Launch the online course', home_id: work.id, horizon: 'quarter', statement: 'Twenty people in the first cohort' });
  const savings = createLifeItem(db, { kind: 'goal', title: 'Save for the summer trip', home_id: money.id, horizon: 'year' });
  const training = createLifeItem(db, { kind: 'project', title: 'Spring training plan', home_id: health.id, serves: [half.id], outcome: 'Three runs a week until race day' });
  const module3 = createLifeItem(db, { kind: 'project', title: 'Course module 3', home_id: work.id, serves: [course.id], outcome: 'Recorded and edited' });
  const kitchen = createLifeItem(db, { kind: 'project', title: 'Kitchen renovation', home_id: family.id, outcome: 'New counter and lights' });
  createLifeItem(db, { kind: 'topic', title: 'Stoicism', home_id: health.id });
  createLifeItem(db, { kind: 'topic', title: 'Photography', home_id: family.id });

  // ---- People and companies ----
  const nordlicht = createCompany(db, { name: 'Nordlicht', website: 'nordlicht.example', body: 'Design studio. We work with them on the course visuals.' });
  const hafen = createCompany(db, { name: 'Hafenkante', body: 'Event venue by the harbour.' });
  const lena = createPerson(db, { name: 'Lena Fischer', company_id: nordlicht.id, role: 'Designer', emails: 'lena@nordlicht.example', how_met: 'At a workshop in Hamburg', body: 'Likes short calls, sends drafts on Fridays.' });
  const jonas = createPerson(db, { name: 'Jonas Weber', company_id: hafen.id, role: 'Venue manager', emails: 'jonas@hafenkante.example', body: 'Ask him early about dates.' });
  const mara = createPerson(db, { name: 'Mara Klein', role: 'Sister', body: 'Birthday on the 28th.' });

  // ---- Notes (with links, mentions and task lines) ----
  const agenda = createNote(db, { title: 'Workshop agenda', body: `Ideas for the half-day workshop with ${link('Lena Fischer', 'people', lena.id)}.\n\n## Flow\n- Welcome and the one question\n- Capture exercise, 20 min\n- Build your first project page\n\n- [ ] Send the agenda to Lena @${day(1)} ~20m\n- [ ] Book the room at ${link('Hafenkante', 'companies', hafen.id)} @${day(3)} ~15m` });
  updateNote(db, agenda.id, { home_id: module3.id });
  const runs = createNote(db, { title: 'Training log', body: `Week 4 of the ${link('Spring training plan', 'life', training.id)}.\n\n- Mon: 6 km easy\n- Wed: intervals, 8 x 400 m\n- Sat: long run, 14 km\n\nKnee felt fine after the long run.` });
  updateNote(db, runs.id, { home_id: training.id });
  const kitchenNote = createNote(db, { title: 'Kitchen plans', body: 'Measurements: counter 2.4 m, window 1.1 m.\n\nTwo quotes so far; the second one is clearer.\n\n- [ ] Ask for a third quote ~30m' });
  updateNote(db, kitchenNote.id, { home_id: kitchen.id });
  // An outline (Writing and thinking): three sections, folded.
  const outline = createNote(db, { title: 'Ideas for the autumn workshop', body: 'First thoughts, before the details.\n\n* Format\n  * One exercise\n  * Two exercises\n  * Break in the middle\n* Agenda\n  * Welcome\n  * Build your first page\n* Venue\n  * Nordlicht Studio\n  * Back-up room' });
  for (const bullet of listBlocks(db, outline.id)) if (bullet.depth === 0 && bullet.children) setFolded(db, bullet.id, true);
  // A passage linked and shown live in another note (Writing 2).
  createNote(db, { title: 'Pricing thoughts', body: '* Package: 3 days for 4800 EUR\n  * Prep and a follow-up call\n  * Travel on top\n* Day rate: 1700 EUR' });
  const [pack] = searchBullets(db, 'Package: 3 days');
  createNote(db, { title: 'Proposal outline for Nordlicht', body: `* Price it as a fixed package\n  * ((${pack.id}))\n* Three parts\n  * Two quiet mornings` });
  const proposal = db.prepare("SELECT id FROM notes WHERE title = 'Proposal outline for Nordlicht'").get();
  // Versions: the proposal was changed a few times, once by the assistant.
  const draftOf = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(proposal.id);
  updateNote(db, proposal.id, { body: `${draftOf.body}\n* Next step: send it to Lena`, author: 'assistant' });
  updateNote(db, proposal.id, { body: `${draftOf.body}\n* Next step: send it to Lena on Friday` });
  const question = createComment(db, proposal.id, { anchor: 'Price it as a fixed package', body: 'Is this price too low for Nordlicht?' });
  replyTo(db, question.id, { body: 'Not for three days with the prep included: 1600 EUR a day is under your usual rate, so it is a fair introductory package.', author: 'assistant' });
  // A board in the workshop note (Writing 6).
  const board = createBoard(db, { note_id: outline.id, title: 'Workshop flow' });
  const flow = ['Welcome', 'Deep Work exercise', 'Lunch', 'Pricing case', 'Q&A', 'Close'].map((words, n) => addItem(db, board.id, { kind: 'card', text: words, x: 40 + (n % 3) * 380, y: 60 + Math.floor(n / 3) * 220 }));
  for (let n = 0; n < flow.length - 1; n++) addItem(db, board.id, { kind: 'arrow', from_id: flow[n].id, to_id: flow[n + 1].id });
  updateNote(db, outline.id, { body: `${outline.body}\n\n[Workshop flow](/boards/${board.id})` });
  // The pen (Writing 8): a circle in ink around the pricing case, pressed lightly and then harder.
  addStroke(db, board.id, Array.from({ length: 40 }, (_, i) => [420 + Math.cos(i / 6.3) * 200, 330 + Math.sin(i / 6.3) * 90, 0.2 + (i / 39) * 0.7, i * 18]));
  // Imports (Writing 9): a small made-up vault, twice, and a made-up Day One export.
  const vault = [
    { path: 'Autumn vault/Pricing history.md', text: 'The package started at 3600 EUR. See [[Pricing thoughts]].' },
    { path: 'Autumn vault/Workshop venues in Hamburg.md', text: 'Nordlicht Studio, the harbour loft, the library room.' },
  ];
  importObsidian(db, vault, { source: 'Autumn vault (example)' });
  importObsidian(db, vault, { source: 'Autumn vault (example)' });
  importDayOne(db, { entries: [1, 2, 3, 4, 5].map((n) => ({ uuid: `DEMO-${n}`, creationDate: `2026-10-0${n}T07:30:00Z`, timeZone: 'Europe/Athens', text: `Morning page ${n}: coffee, a walk, three lines about the workshop.` })) }, { source: 'Journal.json (example)' });
  createNote(db, { title: 'Books to read', body: '- Meditations, Marcus Aurelius\n- The Art of Learning\n- Atomic Habits (again)\n\nA chapter a night before bed.' });
  createNote(db, { title: 'Course outline', body: `Module 1: capture. Module 2: organise. Module 3: plan the week.\n\nSee ${link('Workshop agenda', 'notes', agenda.id)} for the live version.` });
  createNote(db, { title: 'Bank call', body: 'Called the bank about the mortgage. They will send the new rate by Friday. Ask for the fixed 10-year offer.' });

  // ---- Journal ----
  const healthJournal = createJournal(db, 'Health');
  createEntry(db, { day: day(-1), title: 'Long run', body: 'Long run by the river, 14 km. Slow and steady, felt good at the end.', journal_id: healthJournal.id });
  createEntry(db, { day: day(-2), body: `Good call with ${link('Lena Fischer', 'people', lena.id)} about the course visuals. She will send two options.` });
  createEntry(db, { day: day(-3), body: 'Quiet day. Cleaned up the inbox and planned the week.' });
  createEntry(db, { day: day(-5), title: 'Kitchen', body: 'Visited the showroom with Mara. The oak counter it is.' });
  createEntry(db, { day: today, body: 'Started the day with a short walk. Coffee with the plan for module 3.' });

  // ---- Tasks of every kind ----
  const task = (text, fields = {}) => createTask(db, { text, ...fields });
  const offer = task('Write the offer for Nordlicht', { due: today, estimate: 90, flag: 'must', home_id: module3.id, goal_week: monday });
  const invoice = task('Pay the electricity bill', { due: today, estimate: 10 });
  const call = task('Call Jonas about the venue', { due: today, estimate: 20 });
  const slides = task('Prepare the workshop slides', { due: today, estimate: 60, flag: 'like', goal_week: monday });
  task('Send invoice 2026-118', { due: today, estimate: 5, remind_time: '14:00' });
  task('Water the plants', { estimate: 10, repeat: 'every monday' });
  task('Weekly review', { estimate: 45, repeat: 'every friday' });
  task('Stretch for ten minutes', { due: today, estimate: 10, repeat: 'every day' });
  task('Renew the train pass', { due: day(-2), estimate: 15 });            // missed
  task('Send Lena the proposal', { due: day(1), estimate: 45, flag: 'must', goal_week: monday });
  task('Buy a birthday gift for Mara', { due: day(2), estimate: 30 });
  task('Book the kickoff room', { due: day(3), estimate: 30 });
  task('Pay the quarterly tax', { due: day(5), estimate: 45, flag: 'must', home_id: money.id });
  task('Record module 3, lesson 1', { due: day(2), estimate: 120, home_id: module3.id, goal_week: monday });
  task('Long run, 16 km', { due: day(5), estimate: 100, home_id: training.id });
  task('Ask the plumber about the sink', { estimate: 15 });
  task('Call the dentist', { estimate: 10 });
  task('Sort the photos from the trip', { estimate: 60 });
  task('Have a think about how the course could keep working after launch: what people will ask, what I can answer once and reuse, and what needs a person', {});
  task('Learn to bake sourdough', { due: 'someday' });
  const done = task('Answer the venue email', { due: today, estimate: 10 });
  changeTask(db, done.id, { done: true, plan_part: 'morning', plan_at: '08:30' });

  // The day planned: times, a block and the Highlight.
  changeTask(db, offer.id, { plan_part: 'morning', plan_at: '09:00' });
  changeTask(db, invoice.id, { plan_part: 'morning', plan_at: '12:15' });
  changeTask(db, slides.id, { plan_part: 'afternoon' });
  setHighlight(db, today, offer.id);
  createBlock(db, { day: today, starts_at: '14:30', ends_at: '16:00', kind: 'deep', title: 'Course work' });
  void call;

  // ---- Events: your own, and two other calendars (kept as read, never read again) ----
  const event = (title, d, from, to) => createEvent(db, { title, starts_at: `${d}T${from}`, ends_at: `${d}T${to}` });
  event('Dentist', day(2), '08:30', '09:15');
  event('Dinner with Mara', day(2), '19:00', '21:00');
  event('Gym', today, '07:00', '08:00');
  setOwnColour(db, 1);
  const compact = (d) => d.replaceAll('-', '');
  const ics = (name, events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Demo//EN', `X-WR-CALNAME:${name}`,
    ...events.flatMap(([uid, title, d, from, to]) => ['BEGIN:VEVENT', `UID:${uid}@demo`, 'DTSTAMP:20261001T000000Z', `SUMMARY:${title}`,
      `DTSTART:${compact(d)}T${from.replace(':', '')}00`, `DTEND:${compact(d)}T${to.replace(':', '')}00`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  const calendar = (name, events) => {
    const added = addCalendar(db, { url: `https://calendar.example/${name.toLowerCase()}.ics`, name });
    db.prepare('UPDATE calendars SET body = ?, fetched_at = ? WHERE id = ?').run(ics(name, events), new Date().toISOString(), added.id);
  };
  calendar('Work', [
    ['lena', 'Call with Lena', today, '10:30', '11:15'], ['lunch', 'Lunch with Jonas', today, '13:00', '14:00'],
    ['review', 'Proposal review', day(1), '15:30', '16:30'], ['team', 'Team meeting', day(3), '10:00', '11:00'],
    ['kickoff', 'Course kickoff', day(4), '14:00', '15:30'],
  ]);
  calendar('Family', [['mara', 'Mara’s birthday party', day(2), '17:00', '18:30'], ['school', 'School play', day(4), '18:00', '19:00']]);

  // ---- Earlier days closed, last week reviewed ----
  closeDay(db, day(-1), { line: 'Long run done, and the course outline is finally clear.' }, { today });
  closeDay(db, day(-2), { line: 'Good call with Lena; a slow afternoon.' }, { today });
  closeWeek(db, addDays(monday, -7), { wins: 'Sent the course plan, ran three times.' }, { today });

  // ---- The Inbox: captures waiting to be sorted ----
  createCapture(db, { body: 'book the car service before the trip' });
  createCapture(db, { body: 'Idea: a short video for each module, two minutes each' });
  createCapture(db, { body: 'Slept badly, a short walk helped' });
  createCapture(db, { body: 'https://example.com/article-on-weekly-reviews' });

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (path.resolve(DEMO_DIR) === path.resolve(appDir, 'data')) throw new Error('The demo never writes into data/.');
  fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  const db = openDatabase(DEMO_DIR);
  fillDemo(db, undefined, { dataDir: DEMO_DIR });
  db.close();
  console.log(`Made-up data is in ${DEMO_DIR}. Start it with: npm run demo:start`);
}
