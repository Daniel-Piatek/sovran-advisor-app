---
title: Tour
paths: ^/tour$
---
The Tour is short films of Sovran Advisor, narrated. Open it any time from Tour in the sidebar, just above Settings.

## How you use it

- **The basics** comes first: what each part of the app is for, how the parts fit together, and what to try first. Everything in it works straight after you install.
- Under it, **More you can switch on** has a card for each part that starts switched off: Phone capture, Tasks, Planner, Calendar, Boards and My Life. Click **Watch** to see its short film.
- Ready for one? Click **Switch it on** on its card. It is the same switch as in Settings › Modules, and you can switch it off there again. Once it is on, the card offers to open it.
- In a film, pause with the round button, a click on the film, or the space bar. **Sound on** plays the voice; **Mute** stops it. The buttons under a film jump to its scenes.

## How it works

The films are pages in `public/tour/` (`basics.html`, `extras.html`), shown in a frame on the Tour page; the voice is mp3 files in `public/tour/voice/`. The page itself is `public/tour.js`. Switch it on calls the same `/api/modules` switch Settings uses, so nothing you made is touched either way.
