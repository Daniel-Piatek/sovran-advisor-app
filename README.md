# Sovran Advisor

Your trusty companion on your Sovran Quest journey: a journal, the people who matter to you,
notes, and an AI assistant that knows them, all on your own computer.

- **Yours, on your computer.** Everything you write is kept in the app's `data` folder on your
  own computer. There is no account and no sign-in.
- **Your assistant** is your own Claude (Claude Code, with your own Claude subscription) or,
  if you use ChatGPT instead, your own ChatGPT (OpenAI's Codex, with your own ChatGPT plan).
  Choose in Settings › Your assistant's AI. It reads and writes your notes, journal and people
  when you ask.
- **The Sovran Library.** Paste the key you were given in Settings, and your assistant can also
  search the Sovran teaching and, if you have them, your own decodes.
- **More when you want it.** Tasks, Planner, Calendar and My Life are built in and switched off.
  Switch them on in Settings › Modules. The Calendar shows a day, three days or a week.
  Also off until you switch them on: **My Life in depth** (Habits, a rhythm you keep, such as
  "Run 3× a week") and **Mail** (your own mail kept in the app; it needs a Google sign-in of your
  own, and directions for setting that up will follow, so leave it off for now).
- **Help pages** (off until you switch them on): a "?" after every page's title opens a short page on
  what it is for and how to use it, and your assistant answers "how does this work?" from the same pages.
- **Model and effort** (on; switch it off in Settings › Modules): for each chat, choose which model answers
  (Claude: Haiku quick and light, Sonnet balanced, Opus deep thinking, Fable the most capable; ChatGPT:
  GPT-6 Luna, GPT-6.1 Terra, GPT-6.1 Sol, GPT-6 Astra) and how long it thinks (Low to Max). **Usual** leaves it to the AI itself.
- **A daily backup** of your database is kept in `data/backups` (the last 14 days).
- **Phone, backups and moving** (off until you switch it on): a Capture icon for your phone's home
  screen (two taps to your Inbox), your daily backups each checked, and one moving file that takes
  everything to a new computer. No cloud account, nothing to pay.

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

> Install Sovran Advisor for me by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

It does the rest and tells you when it needs you. To get a newer version later, tell it:
"update Sovran Advisor".

## Make it your own

Ask Claude to change your copy the way you like it. `CUSTOMISING.md` explains how, and how
your changes stay safe when you update.

## For the curious

- Start it by hand: `npm start`, then open http://127.0.0.1:3300.
- Tests: `npm install`, `npm run test:setup` once, then `npm test`.
- How the app is built and the rules Claude follows when changing it: `AGENTS.md`.

Copyright (c) 2026 Daniel Piatek. All rights reserved; see `LICENSE`.
