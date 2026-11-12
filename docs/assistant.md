---
title: Assistant
paths: ^/assistant(/|$)
---
A chat with your own AI assistant, inside the app. It can read and write your notes, journal and tasks when you ask.

## How you use it

- **New chat** starts a conversation. Earlier chats are listed beside it.
- Type and press **Enter** to send; **Shift+Enter** starts a new line. **Stop** ends an answer early.
- Under an answer, **Citations** are the pages it used: click one to open it.
- When it does something for you, it shows a card. A task you asked for is added at once (with **Undo**). A change you did not ask for in so many words waits for **Apply** or **Dismiss**.
- Settings › **What your assistant may do alone** decides what it does by itself and what waits for your yes.
- Choose which AI answers (Claude or ChatGPT) in Settings › **Your assistant's AI**.

## How it works

The assistant is Claude Code (or OpenAI's Codex) running on your own computer with your own plan; no API key is needed. `assistant.js` starts it, each conversation in its own folder. It reaches your data only through the app's own tools in `assistant-tools.js`, served to it by `mcp.js`. What it may do alone is checked by `permissions.js` at every step. The page is `public/assistant.js`.
