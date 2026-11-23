# Plans: notes for the 3-D Model project

Created 23 Nov 2026 · Last updated 23 Nov 2026 · LIVING (kept current)

These are Daniel's planning pages for Sovran Central (the student app), go Sovran (its phone page), APP Daniel (his own app) and the Sovran Library. They were copied here so the 3-D Model project, which is planning how to bring the **Sovran Compass / Meta Framework 3D model** into Sovran Central and APP Daniel, can read them. Until now they lived only in Claude project files.

This repository is public. Client codes, names, birth data, keys and private Google Drive links were taken out of these copies.

## What is here

| File | What it is | State |
|---|---|---|
| [system-map.html](system-map.html) | The whole Sovran system, when it's done: every part, where it lives, how it connects. Open it in a browser and click any box. | LIVING. Updated 23 Nov (student app renamed Sovran Central; go Sovran and Sovran Compass added). |
| [phone-app-plan.html](phone-app-plan.html) | The phone plan from 17 Nov that became go Sovran. | SNAPSHOT of 17 Nov, with a status note added 23 Nov. |
| [library-plan.html](library-plan.html) | The cloud library plan: what the Sovran Library holds, in three locked parts. | SNAPSHOT of 8 Nov, with a status note added 23 Nov. |

**Not copied here:**

- **The Later list** (`later-list/later-list.md`) could not be found. It is not in this repository, the APP Daniel repository (any branch), sovran-machine, the "Systems Clean-up & New Start" project files, Daniel's `~/APP Daniel` or `~/Sovran Machine` folders, his Daniel App notes, or his published pages. It most likely sits in the Sovran Advisor Claude project's own files. Daniel can upload it to the 3-D Model project directly.
- **The Start Here page** is about 5 MB with 230 attached films and pictures, too heavy for a repository every student installs from. It is a shareable page: <https://claude.ai/artifact/2f264pbVe7JE9XWbeU6yYE>. Its design is described below.

## Compass and the meta-framework: what the plans say

- **The library plan (8 Nov):** "Sovran Compass: 63 zones and 40 practices" goes into the *shared* part of the Sovran Library (readable by anyone with a valid key), **later**, once the Compass becomes a module. Still true on 23 Nov.
- **The system map:** Sovran Compass is "not decided yet": planned as a module in Sovran Central and APP Daniel, with nothing built in either app.
- **Code:** there is no Compass, Meta Framework or 3D code in any repository yet.
- **The Later list itself:** not readable from here (see above), so its exact words on Compass are not in this note.
- **Earlier pages** (5 Nov, both private to Daniel): the Sovran Compass prototype (<https://claude.ai/artifact/4LhKsY8cJbbfo25mh8sbmg>) and a mock-up of Compass inside APP Daniel (<https://claude.ai/artifact/EJgFfBaVBYFTPis3cCbAHo>). The mock-up shows Compass as its own sidebar group (My compass, Check-in, My clients) and a daily question on Today.
- **The 3D model** is a single file on Daniel's Mac: `~/Documents/Documents - Daniel's Mac mini/Claude/Projects/ICOR as MODEL/3-Axis Meta Framework - 3D Model.html`.

## Rules a new feature must follow

**How the student app works**

- Sovran Central runs on each student's own computer, as a small local server. There is no Sovran server and no sign-in. All of a student's data is one file on their computer (`data/app.db`) and stays there.
- The only "account" is the student's **Sovran Library key**. Cloud features (Library, Group Circle, Tell Daniel, go Sovran) use it, and the cloud finds who someone is from the key alone. The key never reaches a web page.
- The assistant is the student's own Claude or ChatGPT, on their own paid plan. Daniel pays nothing per student.
- go Sovran (the phone) never reaches the computer directly. It seals items and leaves them in a drop box in the cloud; the computer collects them.

**How a feature is built** (from [AGENTS.md](../../AGENTS.md), read it first)

- Every feature is a **module** that can be switched on or off in Settings › Modules. New optional features usually start switched off.
- Plain HTML, CSS and JavaScript in `public/`, Node's own web server, SQLite. No framework and **no build step**. A new add-on, such as a 3D library, needs Daniel's yes first.
- Prefer new files (a new module, a new screen) over editing the app's files, so student updates merge cleanly.

**How it looks**

- Every colour, font and size comes from `public/tokens.css` as `var(--…)`. No raw values. A new colour or component needs Daniel's approval first and then goes on the in-app Library page (`/library`).
- One Crimson accent, on one thing per screen. Fonts: Gloock for headings, Plus Jakarta Sans for menus and buttons, Inter for reading. Flat surfaces separated by thin lines, no shadows or gradients inside the app.
- Shape tells kinds apart, never colour alone.
- The brand's single home is the Live Sovran Brand folder on Daniel's Mac (`~/Live Sovran Brand`), mirrored in the private repo `Daniel-Piatek/live-sovran-brand`. Start at its `README.md`.
- **Student guide pages** (like Start Here) use the Start Here design: numbered doors, a charcoal background with small crowns, raised white boxes, detail folded one tap deeper.
- **Line spacing** on every Sovran page and film: body text 1.44; short text in cards, boxes and captions 1.36. Never 1.5 or more.
- **Dates:** every page made for Daniel shows "Created" and "Last updated" at the top, and whether it is LIVING or a SNAPSHOT.

**How it speaks**

- Two named writing styles. **Descriptive** (direct, guide-like) is the default for assistant answers and help. **Evocative** (mirrors the person back so they see themselves anew) is for reports like Sovran Pattern, or on request. The aim: readers are not told who they are; they see themselves anew. "You are…" sentences are banned in Evocative only.

## Students and facilitators sharing data

**Nothing is decided for Compass.** No decision has been made on how students and facilitators share Compass data, and no facilitator role exists beyond Daniel himself.

What exists today, as patterns a Compass plan could follow:

- **Group Circle:** a Quest group's shared space in the cloud. Only that group sees its posts; Daniel posts Announcements with his own guide key. A homework tick is seen only by the student and Daniel.
- **Tell Daniel:** a student chooses to send Daniel a note from where something happened. Nothing is sent without pressing Send.
- **Share to Group Circle** fills the post box, but nothing is shared until the student presses Post.
- Reports go from Daniel to a student only, behind that student's key.

The 5 Nov Compass mock-up showed one *idea*, never decided: a facilitator sees a client's practice map and check-in rhythm, while check-in words and challenge readings stay private, and the client chooses what to share.
