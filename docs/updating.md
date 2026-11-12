---
title: Updating Sovran Advisor
paths: ^/help/updating$
---
To get the newest version of Sovran Advisor (an update, an upgrade, a new version), you ask Claude Code to do it for you. It takes one line.

## How you use it

1. Open **Claude Code** on your computer, the same way you did when you installed Sovran Advisor. If you use ChatGPT, open **OpenAI's Codex app** instead.
2. Start a new chat there, paste this one line and press Enter:

   > Update Sovran Advisor by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

3. That is all. It finds the app by itself, so you do not need to open the app's folder first. If it asks you a question before a step, answer it, then wait until it says it is done.
4. Reload this page in your browser.

What is kept: everything you wrote (notes, journal, people, tasks), your settings, and any changes you made to your own copy. A newer version upgrades your database by itself, after keeping a whole copy of it.

If nothing new is out yet, it simply says the app is already up to date. To go back to the version before, paste "Undo the last Sovran Advisor update" the same way.

## How it works

The update steps are the section "For Claude or Codex: updating it" in `INSTALL.md`: stop the app, save your own changes as their own step, mark the spot so it can be undone, bring in the new version with git, and start it again. Your data lives in the `data/` folder, which an update never touches. Changes you made to the app are kept too, with a list of them (see `CUSTOMISING.md`).
