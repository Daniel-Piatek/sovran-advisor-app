---
title: Tasks
module: tasks
paths: ^/tasks$
---
Every task in one place: the ones you add here and every to-do line written in a note, a journal entry or a person's page.

## How you use it

- The tabs at the top are your views: **Today**, **Upcoming**, **All** and **Done**. Each has a number key.
- With **Tasks in depth** on (Settings › Modules) there are more: **Speedies**, **Reminders**, **Someday**, **Needs a date** and **Missed**. Missed holds tasks planned for an earlier day and not done. They keep their old date until you decide: today, another day, or let it go.
- Add a task with the add button. A task can have a day, a **Must** or **Like** flag, and an estimate.
- Tick the box to finish a task. A task written in a note is the same task in both places, so ticking it here ticks the line there too.
- With **Tasks in depth** on (Settings › Modules): press **q** anywhere to add a task in one line, like "call Lena tomorrow 20m". Fifteen minutes or less makes it a **Speedy**.
- Keys on the list: **j** and **k** move, **e** completes, **t** today, **m** tomorrow, **x** selects several. Press **?** on this page for every key.

## How it works

Tasks are rows in the `tasks` table (`schema.sql`), kept by `tasks.js`. A to-do line in a page (`- [ ] words`) is read again each time the page is saved, so the line and the task never disagree. The page is `public/tasks.js`; quick add on q is `public/quick-add.js`, and reading a day and an estimate from your words is `public/due.js`.
