// Makes made-up test notes, to see how the app behaves with a few thousand of them:
//   npm run seed -- 5000 /path/to/a/test-folder
// then run the app on that folder: PORT=3100 DATA_DIR=/path/to/a/test-folder npm start
// It never writes into the real data/ folder.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db.js';
import { createNote } from '../notes.js';

const words = `idea plan call budget timing scope pricing workshop review inbox calendar habit
  chapter book walk garden client offer launch email follow draft outline question answer
  morning evening weekly monthly goal project topic team design colour layout harbour market
  coffee lunch travel train ticket meeting notes summary decision risk option reason`.split(/\s+/);

// A fixed sequence, so the same count always makes the same notes.
function random(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

export function makeNotes(count, seed = 1) {
  const next = random(seed);
  const pick = () => words[Math.floor(next() * words.length)];
  const sentence = (n) => Array.from({ length: n }, pick).join(' ');
  return Array.from({ length: count }, (_, i) => ({
    title: `${sentence(3)} ${i + 1}`,
    body: Array.from({ length: 2 + Math.floor(next() * 4) }, () => `${sentence(12)}.`).join(' '),
  }));
}

export function seed(db, count) {
  db.exec('BEGIN');
  for (const note of makeNotes(count)) createNote(db, note);
  db.exec('COMMIT');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [countArg, dirArg] = process.argv.slice(2);
  const count = Number(countArg);
  const realData = fileURLToPath(new URL('../data', import.meta.url));
  if (!Number.isInteger(count) || count < 1 || !dirArg) {
    console.error('Use: npm run seed -- <how many> <test folder>');
    process.exit(1);
  }
  const dir = path.resolve(dirArg);
  if (dir === realData || dir.startsWith(realData + path.sep)) {
    console.error('That is the real data folder. Pick a test folder.');
    process.exit(1);
  }
  const db = openDatabase(dir);
  seed(db, count);
  db.close();
  console.log(`Made ${count} test notes in ${path.join(dir, 'app.db')}`);
}
