---
title: Tell Daniel
module: tell
paths: ^$
---
Tell Daniel lets Daniel know when something isn't working, seems off, or raises a question, right from where it happened.

## How you use it

- Press **Tell Daniel** under a Sovran Advisor answer, on a note or a journal entry, after selecting words in a report, or at the foot of Help.
- Pick what it is: **Something isn't working**, **Something seems off here**, **I have a question about this**, or **Other**. Then say why in a few words (for Other, the words are needed).
- **What goes with it** shows exactly what is sent, before you send it: for an answer, your question, the answer (or the part you selected) and what it looked at; for a report, the report, the section and the words you selected; for a note or a journal entry, its title and words. The app's version always goes too.
- Press **Send to Daniel**. Daniel reads every one.
- **Daniel's reply** comes as an alert ("Daniel replied") and a line in your Inbox. Read it, and answer him, in **Help › What you told Daniel**: everything you sent, newest first, with his replies under each one.
- Switch it off in Settings › Modules if you'd rather not have the button.

## How it works

Tell Daniel is the module `tell` (Settings › Modules), on in a new install. `public/tell-daniel.js` shows the window; `tell-daniel.js` checks it and sends it to the Sovran cloud with your Sovran Library key, adding this app's version (`GET /api/tell/version`, `POST /api/tell`). There it waits in `tell_daniel.reports` (`cloud/tell-daniel.sql`, through the `group-feed` web function) with a status, New, Needs digging or Dealt with, for Daniel's Student reports page. Nothing is kept on this computer. Replies (2026-11-24): each report carries a conversation (`tell_daniel.messages`); Daniel's reply comes with the `answer` alert, and `alerts.js` adds an Inbox line. `public/told-daniel.js` draws /told-daniel from `GET /api/tell/mine`, marks Daniel's replies read (`POST /api/tell/:id/seen`) and sends your answer (`POST /api/tell/:id/reply`). You never see Daniel's own note or Claude's notes on it.
