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
- With **Tags** on, it may also suggest a few tags under its suggestion. Tap one to put it on; **Accept** never adds them.
- **From a chat with your AI** (needs **Phone capture** on and your library key in Settings › Sovran Library): in the Claude app, after its first answer about your reports or the teaching, Claude asks “Would you like me to keep this chat saved to your Sovran Advisor?” Say yes, and the chat arrives here as **one item**, marked **From your chat with Claude**; each new question and answer joins it. You can also type “save this” at any time. If you have edited, sorted or deleted the item, what comes after starts a new one, “(continued)”. The first time, Claude asks your permission to use the tool: choose **Always allow**.
- **From your phone** (Settings › Modules › **Phone capture**): scan the code in Settings › Phone capture, add **Sovran Go** to the phone's home screen, then choose **My own thought** or **From someone else** and speak or type. What you keep arrives here within a minute of this app being open. (**Journal entry** there goes straight to your Journal, and **Ask my AI** opens the Claude app, or the ChatGPT app when ChatGPT is your assistant in Settings: scan the code once more after changing that.) Your own glossary and the Sovran glossary fix the spelling of names and course words at once, and your assistant then adds commas and full stops; **From your phone, tidied** shows the words as you said them.
- **Snoozed** shows the ones you put off until a later day. **Inner** and **Outer** separate your own thoughts from things that came from others.

## How it works

Captures are rows in the `captures` table (`schema.sql`), written by `captures.js`. The screen is `public/inbox.js` and the capture box is `public/capture.js`. The suggestions come from `suggestions.js`, which asks your assistant in the background and only reads. A sorted capture is kept, marked with what it became, so nothing is lost. Phone capture is `phone-drop.js` (the app side), `phone/` (the page on the phone, on GitHub Pages) and `cloud/` (the drop box): A chat saved by your AI comes the same way (`chat-saves.js`, table `chat_saves`): the Sovran Library seals each part for this computer alone, with a public key this computer registered, so it cannot be read in the cloud; a note's `kind` says where it goes (`journal` to the Journal, none to the Inbox); each thought is sealed on the phone with a key only the phone and this computer have, and deleted from the drop box once it is here.
