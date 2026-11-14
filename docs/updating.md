---
title: Updating Sovran Advisor
paths: ^/help/updating$
---
To get the newest version of Sovran Advisor (an update, an upgrade, a new version), press one button in Settings.

## How you use it

1. Open **Settings** and find **Updates** near the top. When a new version is out, it says **Update ready** beside the title. The app looks once a day by itself; it never installs anything without you.
2. To look now, press **Check for updates**. You see what is new, in a short list.
3. Press **Update now**. Each step gets a tick as it goes: a whole copy of your notes, your own changes to the app kept, a mark to come back to, the new version, what it needs, and starting again. It takes a minute or two.
4. The app restarts and the page comes back by itself, showing what came in.

What is kept: everything you wrote (notes, journal, people, tasks), your settings, and any changes you made to your own copy. A newer version upgrades your database by itself, after keeping a whole copy of it.

**To go back** to the version before, press **Go back to the version before** under "Updated". If the update also moved your notes forward, it says so first: your notes then go back to how they were just before the update, and anything you wrote since is kept in a copy in your backups folder, so nothing is lost.

**If the button can't do it** (for example the update clashes with a change you made to the app yourself, or your copy was installed from a zip), it puts everything back as it was and shows this one line. Open **Claude Code** (with ChatGPT: **OpenAI's Codex app**), start a new chat, paste it and press Enter:

> Update Sovran Advisor by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

Claude Code then does the update with you and asks before combining your change with the new one. To go back that way, paste "Undo the last Sovran Advisor update".

**Mac and Windows.** The button is made for both. It has not been tried on Windows yet, so if anything looks wrong there, use the Claude Code line above.

## How it works

Settings › Updates is `public/update-settings.js`; the steps are `app-update.js`, the same as the section "For Claude or Codex: updating it" in `INSTALL.md`. The copy of your notes is `data/backups/before-update-<time>.db` (the newest three are kept), your own changes are saved as their own git step, the mark is a tag `before-update-<day>`, and the new version comes in with `git merge` (a clash is undone with `git merge --abort`). `npm install` runs only when what the app needs changed. The daily look (`git fetch`) is listed under Settings › Background jobs. What it knows is kept in a small file, update.json, in the data folder. Your data lives in the `data/` folder, which an update never touches.
