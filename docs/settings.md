---
title: Settings
paths: ^/settings$
---
Settings is where you decide how the app works for you.

## How you use it

- **Modules** switches the optional parts of the app on and off: Tasks, Planner, Calendar, My Life, Dictation, Help pages and more. A part that is off disappears from the sidebar but keeps everything you wrote in it.
- **Your assistant's AI** chooses Claude or ChatGPT.
- **What your assistant may do alone** sets, for each kind of action, whether it just does it or asks you first. Under it, **Activity** lists what it did.
- **Sovran Library** is where you paste your library key, if you were given one.
- **Restart** restarts the app, for example after an update.
- Other parts show here while their module is on, such as Dictation or Phone, backups and moving.

## How it works

The settings are rows in the `settings` table (`schema.sql`). The list of modules and their switches is `modules.js`; each module says what belongs to it. The page is `public/settings.js`.
