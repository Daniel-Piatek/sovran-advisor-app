---
title: My Life
module: life
paths: ^/life(/|$)
---
My Life holds what you keep up for good and what you are working towards, so every note and task can have one home.

## How you use it

- **Key Elements** are the lasting parts of your life, such as Health, Family or Work.
- Under a Key Element sit its **Goals** (what you want to reach), **Projects** (work with an end) and **Topics** (areas you keep learning about).
- With **My Life in depth** on: **Habits**, a rhythm you keep, such as "Run 3× a week".
- Open an item to see its notes and open tasks, and to write in its thinking space.
- Give a note or a task its **Home** in My Life, and it shows on that item's page.
- Press **n** to add a Key Element, and **/** to filter the list by name.

## How it works

Every item is a row in the `life_items` table (`schema.sql`) with its kind, kept by `life.js`; rules there keep the structure honest (a Goal stands on a Key Element). The page is `public/life.js`. Your assistant reads a short summary of My Life on every turn, so it knows what matters to you.
