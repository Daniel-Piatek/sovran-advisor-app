---
title: Journal
paths: ^/journal(/|$)
---
Your journal opens on today. Write as many entries a day as you like; each one is its own page.

## How you use it

- **New entry** (or press **n**) opens a page for a new entry on the day you are looking at. Write, and it saves by itself.
- Each entry shows its time on the day's page. Open one to give it a title or write more.
- Move to another day with the arrows, or open the month to jump to any day.
- You can keep separate journals, such as **General** and **Health**. An entry belongs to one journal.
- Type **[[** to link an entry to a note or another day, just like in a note.

## How it works

Entries live in the `journal_entries` table and journals in `journals` (`schema.sql`); `entries.js` reads and writes them, and `public/journal.js` draws the day and the entry pages. An entry uses the same editor as a note (`public/editor.js`), so the same / menu and links work. Like a note, a deleted entry is only marked deleted and can come back.
