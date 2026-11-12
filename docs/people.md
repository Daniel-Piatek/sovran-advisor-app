---
title: People
paths: ^/(people|companies)(/|$)
---
Your address book with a memory: the people and companies that matter to you, with what you know and wrote about them.

## How you use it

- **New person** (or press **n**) adds someone. **Companies** has its own list.
- A person's page holds their details, your notes about them, and everything that mentions them.
- A person has initials in a circle; a company has a letter in a square.
- With **People in depth** on (Settings › Modules):
  - Type **@** in any text to name a person, or **@@** for a company. Their page lists every place you named them.
  - Log a call, a coffee or a message in one line, with when it happened.
  - Give someone a rhythm (for example every month) and see who is due in the **Reconnect** list.

## How it works

People and companies are rows in the `people` and `companies` tables (`schema.sql`), kept by `people.js`. The pages are `public/people.js`. Mentions are kept by `links.js`, logged moments by `interactions.js`, and the reconnect rhythm by `reconnect.js`. Importing contacts is `import-contacts.js`; merging two entries for the same person is `merge-people.js`.
