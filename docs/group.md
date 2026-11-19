---
title: Group Circle
module: group
paths: ^/group(/|$)
---
Group Circle is your Quest group's shared space. Daniel posts homework, reminders and news in **Announcements**, and everyone in your group shares in the **Circle**. Only your own group sees it: someone in another Quest never sees your posts, and you never see theirs.

## How you use it

- Open **Group Circle** in the sidebar. A red number beside it says how many new posts wait. At the top of the page are two tabs, **Announcements** and **Circle**, each with its own count.
- The first time, pick the name your group will see on what you post. A first name is fine. Daniel can change it for you later.
- **Announcements** come from Daniel only. Each one is marked **Homework**, **Reminder** or **Announcement**. Homework can have a due date and a **Mark as done** tick: only you and Daniel see your tick. You can like an announcement and ask a question under it.
- **Circle**: write in the box at the top and press **Post**. The **+** button adds things to a post; for now that's **Add image** (up to four pictures).
- Pictures are made smaller on your computer before they're sent, to about 200 KB each, and what the camera wrote into the photo, such as where it was taken, is left behind. Each picture downloads to your computer once and is kept here.
- Like a post with the heart, and write a comment under it. The **•••** on your own post lets you **Edit** or **Delete my post**; on someone else's it lets you **Let Daniel know about this post** quietly, if something isn't right.
- **Share to Group Circle**: on a note, a journal entry, or under an Assistant answer, this button opens the Circle with those words already in the box. Check them before you press Post: a journal or a reading can hold things you'd rather keep private. Nothing is posted until you press Post.
- When a Quest finishes, its Group Circle stays here to read, and closes to new posts and comments.
- Group Circle needs your Sovran Library key (Settings › Sovran Library) and the internet. Switch it off in Settings › Modules if you'd rather not see it.

## How it works

Group Circle is the module `group` (Settings › Modules), on in a new install. Posts, comments, likes, homework ticks and pictures live in the Sovran cloud (schema `group_feed`, `cloud/group-feed.sql`), reached through the web function `group-feed` (`cloud/group-feed/index.ts`) with your Library key. The cloud finds your group from the key, never from what the app asks for, so a group can only ever read and write its own posts; Announcements are written only with Daniel's own guide key. `group-feed.js` asks with your key and passes the answer to the page; the key never reaches the page. The addresses are `GET /api/group` (who you are there and the new counts), `GET /api/group/news` and `/api/group/feed` (a page of posts), `PUT /api/group/name`, `POST /api/group/posts`, `PATCH`/`DELETE /api/group/posts/:id`, `POST /api/group/posts/:id/comments|like|done|flag`, `PATCH`/`DELETE /api/group/comments/:id`, `POST /api/group/pictures` and `GET /api/group/pictures/<group>/<name>.jpg`. Pictures are shrunk in the page (`public/group.js`: at most 1600 pixels on the long side, a JPEG of about 200 KB, drawn again so the photo's own details are left behind) and kept in `data/group-pictures` once fetched. This computer remembers only the newest post it has shown in each tab (`group.seen`), for the counts. **Share to Group Circle** leaves the words in this browser for the Circle's box (`startGroupDraft`).

The same page runs in Daniel's own app with his guide key instead (`useGroup({ keyOf: guideKey, guideApp: true })`): a group picker (or All groups), the announcement box (kind, group or all groups, a due date for homework, questions on or off), **Hide from students**, **Delete** and **Pause** on anyone's post or comment, how many marked each homework done, and two more tabs, **Flags** and **People** (`GET /api/group/flags`, `POST /api/group/flags/clear`, `GET /api/group/groups`, `POST /api/group/manage`, `POST /api/group/announcements`, `POST /api/group/posts|comments/:id/hide`). The guide key is made on that computer once (`POST /api/group/guide-key`, settings `group.guide_key`); the cloud only ever gets its fingerprint. In a student's app these addresses do nothing: the cloud refuses them without the guide key.
