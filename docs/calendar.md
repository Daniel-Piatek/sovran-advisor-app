---
title: Calendar
module: calendar
paths: ^/calendar(/|$)
---
The Calendar shows what is fixed in your days: meetings, calls and appointments. Tasks never come here; they belong in the Planner.

## How you use it

- Switch between **Day**, **3 days** and **Week**. The arrows step forward and back.
- **New event**, or a click in an empty hour, opens a new event. Click an event to change or delete it (with **Undo**).
- Drag an event to move it, or select it and use the arrow keys: up and down move it a quarter of an hour, left and right a day.
- A thin line shows now.
- With **Calendar links** on (Settings › Modules) you can add your other calendars by their iCal link. They show beside your own, read only, each in its colour.

## How it works

Your own events are rows in the `events` table (`schema.sql`), kept by `events.js`. Other calendars read by link are kept by `calendars.js` and refreshed every hour. The page is `public/calendar.js`.
