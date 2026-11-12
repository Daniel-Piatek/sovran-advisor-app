---
title: Settings
paths: ^/settings$
---
Settings is where you decide how the app works for you.

## How you use it

- **Modules** switches the optional parts of the app on and off: Tasks, Planner, Calendar, My Life, Dictation, Help pages and more. A part that is off disappears from the sidebar but keeps everything you wrote in it.
- **Your assistant's AI** chooses Claude or ChatGPT. **Check** tests that it is installed, signed in and answering (it asks one tiny question), and shows one plain result: it works, the program isn't found, it isn't signed in, a Free Claude plan (Claude Code needs Pro or higher), or what else went wrong. Anything but "works" comes with every step to put it right, from opening Terminal to pressing Check again.
- **What your assistant may do alone** sets, for each kind of action, whether it just does it or asks you first. Under it, **Activity** lists what it did.
- **Sovran Library** is where you paste your library key, if you were given one.
- **Restart** restarts the app, for example after an update.
- Other parts show here while their module is on, such as Dictation or Phone, backups and moving.

## How it works

The settings are rows in the `settings` table (`schema.sql`). The list of modules and their switches is `modules.js`; each module says what belongs to it. The page is `public/settings.js`. The Check button is `checkAssistant` in `ai.js` (`POST /api/assistant/check`: `--version`, then `claude auth status` or `codex login status`, then one question) and its steps are `public/ai-check.js`.
