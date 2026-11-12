---
title: Notes
paths: ^/($|notes/|deleted$)
---
Your notes: anything you want to keep and find again, each on its own page.

## How you use it

- **New note** (top left) opens an empty page. Give it a title and write. It saves by itself as you type; there is no Save button.
- **Search** finds a note by any word in its title or text.
- The switch at the top shows your notes as **cards** or as **rows**.
- Type **[[** in a note to link to another note or a journal day. The page you linked to shows the link under **Linked from**.
- Type **/** at the start of a line for the menu: headings, lists, a to-do line, a picture or a file.
- Paste or drop a picture or a file into a note, and it is kept with it.
- **Delete** moves a note to **Recently deleted** (at the bottom of the list). Nothing is ever really gone: open it there and put it back.
- The **Ask your notes** box at the bottom of every page asks your assistant about what you are looking at.

## How it works

Every note is one row in the `notes` table of your database (`schema.sql`), kept on your own computer in the `data` folder. The list and the note page are drawn by `public/notes-screens.js`; the editor every page shares is `public/editor.js`, and the / menu is `public/slash-menu.js`. Notes are stored as Markdown. Search uses the database's own full-text index. Deleting only marks a note as deleted, so it can always come back. Links are kept in `links.js`; files you add are kept once in `data/files` by `files.js`.
