# Sovran Central and APP Daniel: where things stand (23 Nov 2026)

For the 3-D Model project. Daniel ("D") builds two apps with Claude and is not a coder. Keep replies short and plain.
How it is built (repos, folders, cloud, stack) is in `docs/plans/` of the repo `Daniel-Piatek/sovran-advisor-app`:
start at `README.md`, then `build-map.md`. The rules a new feature must follow are in that README.

## The pieces

- **Sovran Central**: the students' desktop app. It runs on their own computer, with no sign-in, and its data never leaves that computer. Public repo `sovran-advisor-app`.
- **Sovran Advisor**: the assistant inside it. It is the student's own Claude Code or ChatGPT Codex.
- **go Sovran**: the students' phone page (a web app on the home screen). Its code is in the same repo under `phone/`.
- **APP Daniel**: D's own, bigger version of the same app. Private repo `sovran-advisor`, branch `app-daniel-mac`.
- **Sovran Library**: D's cloud library (Supabase project `sovran-library`), reached as an MCP connector. It holds D's teaching, the meaning pieces, and each client's own decodes and reports, each behind that client's key. The code lives in `sovran-machine`, together with the decode and report machine.
- **Live Sovran Platform**: a draft of the public course website (Next.js). It is on D's Mac only and is separate from all of the above.

## Built and live

**Students (Sovran Central and go Sovran):**
- **Core:** Inbox (From Me / From Other / Journal), Journal, Notes, People, and the Sovran Advisor assistant with a model and effort picker and a Check button.
- **Modules, off until a student switches them on:**
  - Tasks, Planner, Calendar (with Google Calendar), My Life (with Habits)
  - Writing tools, Boards, Tags with starter pictures, Help pages, voice dictation
  - phone backups and moving to a new computer
- **Reports:** a page for the student's own Sovran reports, with highlights, comments and "Ask my Sovran Advisor" about a passage.
- **Group Circle:** a shared space for each Quest group. Daniel posts announcements and everyone posts in the Circle. It works on the computer and on the phone, with lock-screen alerts, and D runs it from his own phone.
- **Tell Daniel:** students report a problem or a question. Claude checks new reports every hour from 8 AM to 10 PM (Athens) and writes a diagnosis into each one.
- **go Sovran (new look, 22-23 Nov):** write to the Inbox or Journal, read your reports, Group Circle, and "Ask my Sovran Advisor", which opens the student's Claude or ChatGPT.
- **The library in Claude and ChatGPT:** students can use the Sovran Library from Claude or ChatGPT directly. A chat they choose to keep is saved, sealed, to their Inbox and shows as a chat in Sovran Advisor.
- **For students:** install by pasting one sentence into Claude Code, one-click updates in Settings › Updates, an install guide, the Start Here page, and voiced tour films for every part.
- **Renamed** on 22 Nov to Sovran Central, Sovran Advisor and go Sovran, with new branding.

**D only (APP Daniel):** everything above, plus:
- Mail, Connect, the Writing Desk (with Send out and email drafts), Paperwork & Money (Wise CSV), and files kept in Google Drive.
- A Student reports tab and the guide tools for Group Circle.
- A Versions page, where D presses Release to take in new changes.
- A nightly copy of D's data to the cloud for his private "Daniel App" connector.

## In progress or waiting

- **Students:** D still has to tell them to update to get the latest changes.
- **Windows:** a Windows student was sent install help on 19 Nov, and her answer is still awaited.
- **Course in the app (explored, not built):** D runs the quests on Xperiencify, which can't be shown inside the app. The preferred route is a Course button plus a sign-in link.

## Planned (the later list, `docs/plans/later-list.md`)

- **Sovran Compass module:** the 3D model. So far it is decided only that it becomes its own module, and that its 63 zones and 40 practices go into the shared part of the Sovran Library. Nothing is designed or built yet.
- **Course and online access:**
  - a course page on the Live Sovran Platform website, plus the Course button
  - two-way sync, a web version and Connect lessons 7-8 (APP Daniel only)
  - students' data in the cloud with a sign-in (not decided)
- **Other ideas:**
  - a door that lets the student's own AI apps into the app
  - better assistant answers that use a student's decodes
  - tables in notes
  - students sending their changes back to D
  - a privacy statement and off-computer backups
  - a board from a tag
  - a Writing Desk for students
  - Windows testing

## How work gets done here

- Every change goes through a pull request and is merged only when D says "merge it".
- Students get changes through Settings › Updates. APP Daniel gets them when D presses Release.
- New student features start switched off in Settings › Modules, and the same screens are built in both apps.
- The design follows the Live Sovran Visual Identity Guide v3 (brand repo `live-sovran-brand`).
- D wants routes that need no manual setup from him: no tokens, keys or dashboard steps.
