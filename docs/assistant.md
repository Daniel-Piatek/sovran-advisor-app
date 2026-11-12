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
- With **Model and effort** switched on (Settings › Modules), two choices sit above the box to ask in. **Model** picks which model answers. With Claude: Haiku is quick and light, Sonnet balanced, Opus thinks deeply, Fable is the most capable and uses your plan fastest. With ChatGPT: GPT-6 Luna is quick and light, GPT-6.1 Terra balanced, GPT-6.1 Sol for everyday work, GPT-6 Astra the most capable. **Effort** is how long it thinks before answering, from Low to Max. Each chat keeps its own choice, and a new chat starts with the last one you made. **Usual** leaves it to Claude or ChatGPT. Claude and ChatGPT each keep their own choice. A line in the chat shows when the model changed.

## How it works

The assistant is Claude Code (or OpenAI's Codex) running on your own computer with your own plan; no API key is needed. `assistant.js` starts it, each conversation in its own folder. It reaches your data only through the app's own tools in `assistant-tools.js`, served to it by `mcp.js`. What it may do alone is checked by `permissions.js` at every step. The model and effort are kept by `ai-pick.js` and passed to Claude Code as `--model` and `--effort`, and to Codex as `--model` and `model_reasoning_effort`. The page is `public/assistant.js`.
