---
title: Tags
module: tags
paths: ^/tags(/|$)
---
Tags cut across everything: one tag can be on notes, journal entries, people, companies, tasks and Inbox items at once. The **Tags** tab in Notes lists them, and one tag's page shows all that carries it.

## How you use it

- **Put a tag on**: press **+ Tag** under the title of a note, a journal entry, a person, a company, a task or an Inbox item. Find a tag, or type a new name and choose **Make tag**. Or type **#word** in your writing (for example #retreat); it goes on when the words are saved, and comes off when you take the #word out.
- **Take a tag off**: the small × on the tag. The item stays as it is.
- **Find everything with a tag**: the **Tags** button over each list (Notes, Journal, People, Tasks, Inbox) shows only what carries the tags you pick. In a search box you can also type **#retreat**.
- **One tag's page** (Notes › Tags, then a tag): a heading for each kind with how many there are and the newest two. **Open all** opens that kind's own screen with the tag picked. **Narrow with another tag** shows only what carries both.
- **Pin to the sidebar** on a tag's page puts it under Notes in the sidebar, one click away.
- **Your assistant suggests tags** for an Inbox item, under its suggestion: **Tap to add a tag**. Nothing goes on until you tap. A tag marked **new** is made when you tap it.
- **Settings › Tags** is where you look after them: make **groups** (as many or as few tags in each as you like; one tag sits in one group or none), move groups up or down, rename a tag, join two tags into one, or remove a tag. Removing a tag takes it off every item and never deletes an item; **Undo** puts it back on exactly those.
- Names ignore capitals: Retreat and retreat are one tag. Spaces are allowed.
- An Inbox item's tags go with it into the note, journal entry or task it becomes. Imports from Obsidian and Day One keep their tags.
- Your tags stay on this computer. They never go to the cloud.

## How it works

Tags are rows in `tags`, groups in `tag_groups`, and which item carries which tag in `item_tags` (`schema.sql`, step 79), all kept by `tags.js`. A #word puts on a tag marked `from_text`; a tag put on with + Tag stays when the words change. The screens are `public/tags.js` (the tag row, the Tags button and its menu), `public/tags-screen.js` (the Tags tab and one tag's page) and `public/tags-settings.js` (Settings › Tags). The Inbox suggestion names tags in `capture_suggestions.tags` (`suggestions.js`); they are only offered.
