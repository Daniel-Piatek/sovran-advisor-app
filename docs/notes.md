---
title: Notes
paths: ^/($|notes/|deleted$|boards)
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
- The **Ask your notes** box at the bottom of every page asks Sovran Advisor about what you are looking at.

## Boards

The **Boards** tab (next to **All notes**) holds whiteboards of their own, each an endless space to work through ideas.

- **New board** makes one and opens it. Give it a name at the top.
- On the left is a list of your **notes**, **journal entries** and **Inbox items**. Search it, then drag one onto the board, or press its **+**. The card stays linked: change the note and the card changes too. A thing already on the board says *On the board*.
- **Card** adds a quick card of your own words (a sticky note). Hover it and press the note button to **make it a real note**; the card then points at that new note.
- **Double-click** a note, journal or Inbox card to open it on the right, read it and change it without leaving the board. **Open the page** goes to its own page.
- **Inbox** opens a window with your Inbox items (waiting and snoozed). Tick one or several and press **Put them on the board**; they stay in your Inbox.
- **Task** opens a window with all your open tasks, grouped by **Missed**, **Today**, **Upcoming**, **No date** and **Someday**, with their time, *Must* and where they live. Search it, tick one or several and press **Put them on the board**.
- **Text** puts words straight on the board. **Arrow** joins two cards with a line: press Arrow, then the card it starts from, then the card it points to.
- Boards have no Pen. Any ink drawn on a board before still shows, and **Clear drawing** takes it all away, with **Undo**.
- Cards show what they are by a coloured bar on the left: blue for a note, yellow for a journal entry, orange for a task, violet for a person, grey for an Inbox item.
- **Group** adds a coloured box with a name. Drag its name bar and the cards inside move with it; drag its corner to make it larger or smaller; hover it to change its colour.
- **Hide notes** folds the list away so the board gets the whole width (**Show notes** brings it back; it is remembered). **Full screen** fills the whole screen with the board; **Exit full screen** or Esc goes back.
- Move around by dragging the empty space, or by scrolling. Zoom with **−** and **+**, or hold Ctrl (Cmd on a Mac) and scroll. **Show all** brings everything into view.
- A board's tile in the Boards tab has a bin to delete it, with **Undo**.
- Boards you made inside a note (**/board**) stay in their note; they are listed under the tiles.

## How it works

Every note is one row in the `notes` table of your database (`schema.sql`), kept on your own computer in the `data` folder. The list and the note page are drawn by `public/notes-screens.js`; the editor every page shares is `public/editor.js`, and the / menu is `public/slash-menu.js`. Notes are stored as Markdown. Search uses the database's own full-text index. Deleting only marks a note as deleted, so it can always come back. Links are kept in `links.js`; files you add are kept once in `data/files` by `files.js`.

Boards are the `boards` and `board_items` tables, kept by `boards.js`. A board of its own has `endless` set: its canvas is 20000 by 20000 units, and the page shows a window onto it that you move and zoom (`public/board.js`; where you were is remembered in this browser). A card that points at a note, a journal entry (`journal_entries`) or an Inbox item (`captures`) only keeps which one; its words are read live every time. A group is an item of kind `group` with a `color`; moving it moves the cards whose middle is inside it, in one step on the server. The Boards tab is `public/boards-list.js`, a board's page `public/board-screen.js` (with the list on the left), and the opened card on the right `public/board-peek.js`. Boards have their own switch, **Boards** in Settings › Modules (off until you switch it on), and need Writing and thinking on too.
