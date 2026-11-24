---
title: Tour
paths: ^/tour$
---
The Tour is short videos of Sovran Central, narrated. Open it any time from Tour in the sidebar, just above Settings.

## How you use it

- **The Basics** video comes first: what each part of the app is for, how the parts fit together, and what to try first. Everything in it works straight after you install.
- Under it, **More in your app** has a card for Group Circle (on already) and for each part that starts switched off: go Sovran, Tasks, Planner, Calendar, Boards and My Life. Click **Watch** to see its short video. **All Videos** above a video, or **Back to All Videos** beside Start Again, brings you back here.
- Ready for one? Click **Switch it on** on its card. It is the same switch as in Settings › Modules, and you can switch it off there again. Once it is on, the card offers to open it.
- **Right where you are.** A page that has its own video (Sovran Quest, Group Circle, Tasks, the Planner, the Calendar, Boards and My Life) shows **How … works** with a red play button, just under the page's top line at the right. Settings › Sidebar and Settings › go Sovran have one too. It opens that page's video here, and the small **← … Module** button above and under the video (for example **← Sovran Quest Module**) takes you straight back to the page.
- In a video, pause with the round button, a click on the video, or the space bar. **Sound on** plays the voice; **Mute** stops it. The scene buttons under a video jump to its scenes.

## How it works

The films are pages in `public/tour/` (`basics.html`, `extras.html`, `group.html`, and `sovran-go.html` with its phone pictures in `sovran-go/`), shown in a frame on the Tour page; the voice is mp3 files in `public/tour/voice/`. The page itself is `public/tour.js`. The **How … works** links come from `public/page-video.js` (which page has which film); they open `/tour?film=<id>&back=<page>`, and only a page of this app is taken as `back`. Switch it on calls the same `/api/modules` switch Settings uses, so nothing you made is touched either way.
