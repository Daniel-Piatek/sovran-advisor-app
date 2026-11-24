---
title: Sovran Quest
module: quest
paths: ^/quest(/week-\d+(/transcript)?)?$
---
The Sovran Quest page shows your Quest group's weeks, newest first: the daily practice, this week's homework with a place to start it, and the weekly group call with its transcript and replay. Daniel publishes each week after the Monday call.

**Watch the film:** [Sovran Quest in the Tour](/tour?film=quest) shows all of this in a few minutes, on your computer and on your phone.

## How you use it

- Open **Quest** in the sidebar, in its own part at the bottom with Group Circle. It shows while you are in a Quest group. The weeks are on the left; press one to open it.
- **Daily practice**: **Open today's practice** opens your practice on Xperiencify in your browser, where your reminders and points are kept.
- **This week's homework**: each piece has one bar.
  - **Start in my journal** makes a journal entry for today named *Sovran Quest · Week 2 · Homework 1*, with the homework at the top. Write under it.
  - **Start with Sovran Advisor** opens a new chat with the same name and the homework written in, ready to send.
  - **Stuck? Ask Daniel** sends Daniel your question with the homework it's about.
  - **Done** is your own tick. Only you see it.
- **Your work**, beside each piece, says where you are (Not started, In progress, Done) and links to every entry and chat you started from it.
- **Weekly group call**: **Read the transcript** opens the whole call with a search box. **Ask Sovran Advisor about it** starts a chat about that call. **Watch the replay** opens the recording in Google Drive (sign in with the address you were invited with).
- In Sovran Advisor you can ask about any week, or "where did Daniel talk about…?": it reads the weeks and their transcripts.
- **On your phone**: once go Sovran is set up, a **Sovran Quest** square on its first screen opens the same weeks. Tap a week at the top. **Done** ticks a piece; **Start in my Journal** opens a page to write on, with the homework at the top; press **Save** and it arrives in your Journal on this computer, named for that homework, the next time this computer is on. **Ask my Sovran Advisor** opens your AI with the homework written in. Under **The call** are the summary, the replay and **Read the transcript ›**, with a search box. **Stuck? Ask Daniel** is at the foot. Nothing new to set up: the phone uses the Group Circle key your computer already gave it.
- **Your own AI** (Claude or ChatGPT with your Sovran Library connected) can read your Quest too: ask it about this week's homework, or what was said in a call, and it looks it up.

## How it works

Quest is the module `quest` (Settings › Modules), on in a new install. `quest.js` (the same file as APP Daniel's) reads the weeks and keeps your own links and ticks on this computer (tables `quest_work` and `quest_marks`); `public/quest.js` draws the page. The weeks come from the Quest shelf in the Sovran cloud with your Sovran Library key (`questWeeks` in `group-feed.js`, `cloud/quest.sql`), asked at most once a minute and kept here for when you are offline. The cloud finds your group from your key. Your entries, chats and Done never leave this computer. Sovran Advisor's tool is `quest_read` in `assistant-tools.js`. On go Sovran (`phone/quest.js`) the weeks come from the same shelf with the phone's own Group Circle key; your ticks and entries reach the phone on the sealed shelf item `quest` (`phone-shelf.js`), and a Done or an entry made on the phone comes back as a sealed note (`phone-drop.js`: `takePhoneDone`, `takePhoneEntry`).
