---
title: Planner
module: planner
paths: ^/planner(/|$)
---
The Planner is one day where your fixed events and the tasks you choose meet, so you can see whether the day really fits.

## How you use it

- Your events come in from the Calendar as solid blocks. They cannot be moved here.
- The **Tray** on the left holds what waits: **Missed**, tasks with **no day**, and **Speedies**.
- Drag a task onto **Morning** or **Afternoon**, or press **Place** to put it where there is room. **×** sends it back to the Tray.
- The **budget line** counts the day honestly: meetings plus your tasks' estimates against the time you have. When the day holds too much, it says so in plain words and suggests what to move. It never stops you.
- Pick one **Highlight** for the day: the one thing that makes it a good day.
- At the end of the day, **close the day** in a few lines.

## How it works

The day is worked out by `planner.js` from your events and your tasks. Planning a task gives it that day, so it shows on that day in Tasks too; it never goes on the Calendar. The page is `public/planner.js`; the order of the day is `public/day-order.js`, and the hours view (with Calendar in depth) is `public/day-hours.js`. The budget's settings (how long a task without an estimate counts, the buffer) are in Settings.
