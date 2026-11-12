---
title: Timeline
module: people-plus
paths: ^/timeline$
---
The Timeline shows everything that happened in your app on one line, newest on top.

## How you use it

- A thin line marks now: what is still ahead today sits above it, what already happened below.
- The chips at the top switch each kind (notes, journal, tasks, events, captures) on and off.
- The search keeps the rows with every word you type.
- Click a row to open the thing where it lives.
- Each person and company page has its own Timeline tab with the same stream, for them alone.

## How it works

The Timeline keeps nothing of its own: `timeline.js` reads it each time from your notes, journal, tasks, events and captures. The page is `public/timeline.js`. Each kind has its own icon and its own word, so you can tell them apart without colour.
