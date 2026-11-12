---
title: Inbox
paths: ^/inbox$
---
The Inbox holds every thought you captured quickly and have not sorted yet. Empty it once a day.

## How you use it

- **Capture** (top of the sidebar, or **⌘K** / **Ctrl+K** anywhere) keeps a thought in seconds without deciding where it goes. It lands here.
- Open a capture on the left; sort it on the right. Each choice has a key:
  - **J** makes it a journal entry, **N** a note (or adds it to a note), **T** a task.
  - **D** marks it done when it needed nothing, **Backspace** deletes it.
- After each choice the next capture opens, and **Undo** takes the choice back.
- Your assistant reads each capture and may suggest where it goes. **Accept** takes the suggestion.
- **Snoozed** shows the ones you put off until a later day. **Inner** and **Outer** separate your own thoughts from things that came from others.

## How it works

Captures are rows in the `captures` table (`schema.sql`), written by `captures.js`. The screen is `public/inbox.js` and the capture box is `public/capture.js`. The suggestions come from `suggestions.js`, which asks your assistant in the background and only reads. A sorted capture is kept, marked with what it became, so nothing is lost.
