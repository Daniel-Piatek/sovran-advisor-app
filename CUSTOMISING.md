# Making Sovran Advisor your own

Your copy of Sovran Advisor is yours. You can change how it looks and what it does, the same way
your mentor changes theirs: by asking Claude.

## How to change it

1. Open Claude Code in your Sovran Advisor folder. Or open it anywhere and say "work in my
   Sovran Advisor folder".
2. Say what you want in your own words, for example:
   - "Make the journal start each day with a question I can answer."
   - "Add a box to each person's page for their birthday."
   - "Switch the Planner on."
3. Claude explains what it will do, makes the change, checks it, and tells you when to look.

**Not sure how to start?** Ask the assistant inside Sovran Advisor, for example "I'd like the
journal to look different, how do I do that?". It can't change the app itself (it only works
with your notes, and the app is running while you talk to it), but it helps you put your wish
into words, shows you how to open Claude Code in the right folder, and gives you the sentence
to paste there.

Your notes, journal and people are never part of a change. They live in the `data` folder, and
Claude leaves that folder alone.

## Keeping your changes safe when you update

Now and then your mentor publishes a newer version. You get it by telling Claude
"update Sovran Advisor". Here is how your own changes survive that.

**The safest changes are the ones that never touch the app's files:**

- **Settings.** Anything in Settings (switching a section on or off, your library key, your
  assistant's permissions) is kept with your data, so an update never touches it.
- **Your own additions.** A new screen, tool or module that Claude puts in files of its own is
  rarely touched by an update either, because the update only changes the files your mentor
  sends.

**Changing the app's own files works too.** Most of the time the update simply combines your
change with your mentor's. It only gets stuck when you and your mentor changed the very same
lines. Claude tells you before making a change of this kind.

**Claude keeps a list of your changes** in a file called `MY-CHANGES.md` in your Sovran Advisor
folder: what you asked for, which files it touched, and why. No update ever touches this file.
It means that whatever happens, any Claude can read the list and make your changes again.

**Before every update, Claude**
1. saves your changes as a step of their own (so nothing is half done),
2. marks the spot, so the whole update can be undone if you don't like it, and
3. then brings in the new version.

## If an update clashes with a change of yours

Claude stops and tells you in plain words which of your changes and which of your mentor's
want the same spot. Nothing is lost while it waits for you. You choose one of these:

- **Keep mine.** Your version of that part stays. You might miss your mentor's improvement there.
- **Take the new one.** Your mentor's version goes in. Claude can then make your change again on
  top of it, from `MY-CHANGES.md`.
- **Combine them.** Claude puts both together and shows you the result. This is usually the
  best choice.
- **Not now.** Claude undoes the update completely. Your copy is exactly as it was before, and
  you can update another day.

If you are not sure, say "Combine them and show me". If something looks wrong after an update,
say "undo the last Sovran Advisor update".

## Good habits

- Ask for one change at a time, and look at it before asking for the next.
- You don't have to update. Your copy keeps working as it is.
- Your data also has a daily backup in `data/backups` (the last 14 days).
- If you would like an improvement in everyone's copy, tell your mentor. They can add it to the
  version they send.
