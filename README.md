# Sovran Advisor

Your trusty companion on your Sovran Quest journey: a journal, the people who matter to you,
notes, and an AI assistant that knows them, all on your own computer.

- **Yours, on your computer.** Everything you write stays in the app's `data` folder on your
  own computer. There is no account and no sign-in.
- **Your assistant** is your own Claude (Claude Code, with your own Claude subscription). It
  reads and writes your notes, journal and people when you ask.
- **The Sovran Library.** Paste the key you were given in Settings, and your assistant can also
  search the Sovran teaching and, if you have them, your own decodes.
- **More when you want it.** Tasks, Planner, Calendar and My Life are built in and switched off.
  Switch them on in Settings › Modules.
- **A daily backup** of your database is kept in `data/backups` (the last 14 days).

## Install

Paste this into Claude Code on your computer:

> Install Sovran Advisor for me by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

Claude does the rest and tells you when it needs you. To get a newer version later, tell
Claude: "update Sovran Advisor".

## For the curious

- Start it by hand: `npm start`, then open http://127.0.0.1:3300.
- Tests: `npm install`, `npm run test:setup` once, then `npm test`.
- How the app is built and the rules Claude follows when changing it: `AGENTS.md`.

Copyright (c) 2026 Daniel Piatek. All rights reserved; see `LICENSE`.
