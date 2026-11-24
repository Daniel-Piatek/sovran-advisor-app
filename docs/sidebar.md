---
title: Your sidebar
---
The sidebar is the column on the left with your sections: Notes, Journal, Inbox and the rest. You can put it in your own order, and add thin lines to split it into groups that make sense to you.

## How you use it

- Click **Arrange** at the very foot of the sidebar, under Settings. Or **right-click** anywhere on the sidebar, or go to **Settings > Sidebar > Arrange the sidebar**. The sidebar switches into Arrange: a red **Done** button sits at the top in place of Capture.
- **Drag** any section up or down to where you want it. Quest and Group Circle move too.
- A small **+** sits between two sections. Click it to add a line there.
- Each line has a red **×**. Click it to take that line away. You can drag a line to a new place, too.
- Click **Done** when it looks right. Your sidebar stays that way, even after you restart.
- **Start over** puts back the order and the one line the app came with.
- Tour, Help and Settings always stay at the foot of the column, so you can always find them. The Library is in Settings.
- On a phone the sidebar is a bar along the bottom, and stays as it is.
- To see it done, watch [the short video](/tour?film=sidebar) in the Tour.

## How it works

The sidebar is drawn in `public/shell.js`. Its order, with a `—` for each line, is kept in this browser's storage under `sidebar.layout` (an older `sidebar.order` is read once and then replaced). A line shows only between two sections you can see, so switching a module off never leaves a line at the top, at the bottom or doubled. Arrange mode is `arrangeSidebar()`; Start over is `resetSidebar()`, both also on the Settings page (`public/settings.js`). With the keyboard, Alt+Up and Alt+Down move the section or line you are on; Esc ends Arrange.
