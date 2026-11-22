# Sovran Central

Your trusty companion on your Sovran Quest journey: a journal, the people who matter to you,
notes, and an AI assistant that knows them, all on your own computer.

- **Yours, on your computer.** Everything you write is kept in the app's `data` folder on your
  own computer. There is no account and no sign-in.
- **Sovran Advisor** is your own Claude (Claude Code, with your own Claude subscription) or,
  if you use ChatGPT instead, your own ChatGPT (OpenAI's Codex, with your own ChatGPT plan).
  Choose in Settings › Sovran Advisor's AI. It reads and writes your notes, journal and people
  when you ask. The **Check** button there tests that it is installed, signed in and answering,
  and if not, gives every step to put it right.
- **The Sovran Library.** Paste the key you were given in Settings, and Sovran Advisor can also
  search the Sovran teaching and, if you have them, your own decodes.
- **More when you want it.** Tasks, Planner, Calendar and My Life are built in and switched off.
  Switch them on in Settings › Modules. The Calendar shows a day, three days or a week.
  Also off until you switch them on: **My Life in depth** (Habits, a rhythm you keep, such as
  "Run 3× a week") and **Mail** (your own mail kept in the app; it needs a Google sign-in of your
  own, and directions for setting that up will follow, so leave it off for now).
- **Help pages** (off until you switch them on): a "?" after every page's title opens a short page on
  what it is for and how to use it, and Sovran Advisor answers "how does this work?" from the same pages.
- **Model and effort** (on; switch it off in Settings › Modules): for each chat, choose which model answers
  (Claude: Haiku quick and light, Sonnet balanced, Opus deep thinking, Fable the most capable; ChatGPT:
  GPT-6 Luna, GPT-6.1 Terra, GPT-6.1 Sol, GPT-6 Astra) and how long it thinks (Low to Max). **Usual** leaves it to the AI itself.
- **Boards** (off until you switch it on): a Boards tab in Notes. Each board is an endless whiteboard (with Full screen and Hide notes for the most room): bring your
  notes, journal entries and Inbox items onto it from a list beside it, add quick cards (and make one a real note),
  join cards with arrows, and put cards in coloured groups that move together.
- **Reports** (on from the start; switch it off in Settings › Modules): your own Sovran reports from your Sovran Library (with your Library key),
  to read section by section, with the PDF and the file for your AI to download. Highlight words and add your own comments:
  they stay only in your app, the report itself is never changed, and Sovran Advisor reads them with the report.
- **A daily backup** of your database is kept in `data/backups` (the last 14 days).
- **Phone, backups and moving** (off until you switch it on): a Capture icon for your phone's home
  screen (two taps to your Inbox), your daily backups each checked, and one moving file that takes
  everything to a new computer. No cloud account, nothing to pay.
- **go Sovran** (off until you switch it on; it was called Sovran Go, and before that Phone capture): Sovran Central, with the crown icon, on your iPhone or
  Android phone. It asks what you would like to do: **Ask my AI** opens the Claude app; a **Journal entry**
  lands in your Journal on the day you wrote it; **My reports** lets you read your Sovran reports there, in
  the same Ivory & Gold look, and highlight or comment (it matches the computer); **My own thought** or **From someone else** (speak with
  the keyboard's microphone, or type) lands in your Inbox, even if your computer is off at the time. Each thought is scrambled on the phone and waits,
  unreadable, in the Sovran drop box only until your computer collects it, then it is deleted.
  **Keep this chat saved**: with your library key, Claude can offer to save a chat about your reports to
  your Inbox, one item per chat, sealed so that only your computer can read it.
  On your computer it is tidied: names and course words spelled right (your glossary and the Sovran
  glossary, `sovran-glossary.json`), and commas and full stops added by your own assistant.

## Before you start

- **What you need:** a Mac or a Windows computer, and a paid Claude plan (Pro or higher), because
  the assistant and the installer both use Claude Code. Installing takes about 20 to 30 minutes.
- **What stays private:** your notes, journal and people are stored only on your computer. When
  you talk to the assistant, your question and the notes it looks at are sent to Claude to write
  the answer, under your own Claude account, the same as any chat with Claude. Nothing you write is
  sent to Daniel. (With a Sovran Library key, the assistant's searches of the library go to
  Daniel's library, but your notes do not.)
- **If something goes wrong:** message Daniel directly with a screenshot and a sentence on what you
  were doing. Your notes are copied every day into `data/backups`, so a problem with the app does
  not lose them.

## Install

Paste this into Claude Code on your computer (or, if you use ChatGPT, into OpenAI's Codex app):

> Install Sovran Central for me by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

It does the rest and tells you when it needs you. To get a newer version later, tell it:
"update Sovran Central".

## Make it your own

Ask Claude to change your copy the way you like it. `CUSTOMISING.md` explains how, and how
your changes stay safe when you update.

## For the curious

- Start it by hand: `npm start`, then open http://127.0.0.1:3300.
- On a Mac the computer itself looks after the app: it starts when you log in, stops when you log
  out, and starts again if it ever stops (`scripts/login-agent.js`, set up by the app icon). An app
  left running after a log-out can't see your Claude sign-in, so this keeps the assistant working.
  `npm run login-agent -- --remove` switches it off; the icon then starts the app the old way.
- Tests: `npm install`, `npm run test:setup` once, then `npm test`.
- How the app is built and the rules Claude follows when changing it: `AGENTS.md`.

Copyright (c) 2026 Daniel Piatek. All rights reserved; see `LICENSE`.
- **Tags** (schema 78–79; Settings › Modules › Tags, off until switched on): **+ Tag** under a note, a journal entry, a person, a company, a task or an Inbox item, or **#word** in the writing. The **Tags** button over each list shows only what carries the tags you pick; the **Tags** tab in Notes lists them by your groups, and one tag's page shows each kind with its count and newest two, with **Open all** and **Narrow with another tag**. A tag can be pinned to the sidebar. Settings › Tags: groups of any size, rename, join, remove with Undo. Every tag has the same small tag shape and no colour of its own. Sovran Advisor may suggest tags for an Inbox item; you tap to put one on. Each tag can have a few words on what it is and a picture; **Add the Sovran starter tags** adds the 13 characters and 5 Quests with theirs (the pictures come once from the Sovran cloud with your key). Tags stay on this computer.
