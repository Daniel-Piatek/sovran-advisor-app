---
title: Mail
module: mail
paths: ^/mail(/|$)
---
Your own mail, kept in the app, live with Gmail.

## How you use it

- Every account in one list, sorted into splits by rules you can read.
- Keys: **e** done, **h** remind me, **r** reply, **⌘K** / **Ctrl+K** for every command.
- A mail opens in a sealed frame: no script runs and no picture loads until you allow it for that sender.
- Write a reply under the conversation. You have ten seconds to take a send back, and you can send later.
- Turn a mail into a task or a note with one key.

## How it works

Mail needs your own Google sign-in (`google.js`). Messages are kept in the `mail_messages` and `mail_threads` tables (`schema.sql`); `mail-sync.js` keeps them live with Gmail, and `mail-send.js` sends. The page is `public/mail-app.js`.
