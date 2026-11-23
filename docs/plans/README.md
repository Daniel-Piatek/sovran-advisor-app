# Plans and handover notes

Plans for Sovran Central that used to live only in Daniel's Claude project, copied here on 23 Nov 2026 so any
Claude project can read them. They are for reading. The app does not use them (its help pages are the `.md` files
one folder up, in `docs/`).

| File | What it is | Up to date? |
|---|---|---|
| `build-map.md` | How Sovran Central, go Sovran and the cloud fit together: repos, folders, ports, cloud, stack, install. | 23 Nov 2026 |
| `system-map.html` | One picture of what sits on Daniel's Mac, in the cloud and on students' computers. | Drawn 9-11 Nov, with a status box on top for what changed |
| `phone-app-plan.html` | The plan for a phone app for students, which became go Sovran. | 17 Nov plan, with a status box for what was built |
| `library-plan.html` | The plan for the Sovran Library (Daniel's teaching and each client's own decodes, online). | 8 Nov plan, with a status box. Client codes removed |
| `later-list.md` | Ideas Daniel has parked, including the Sovran Compass. | 23 Nov 2026 |
| `start-here.html` | The students' Start Here page, as published on 23 Nov 2026 (films included, so it is large). | 23 Nov 2026 |

Open an `.html` file in any browser.

## For a new feature such as the Sovran Compass 3D model

### What has been decided about the Compass

- It will be **its own module** in the app (Settings › Modules). That is all that has been decided about its design.
- Its **63 zones and 40 practices** will go into the shared part of the Sovran Library (readable with any student's
  key) once the Compass becomes a module. They are not in the library yet.
- There is no Compass or Meta Framework code, data or 3D work in any repo yet.

### Rules every new feature follows

- **A module, off by default.** Add it to `MODULES` in `modules.js` with `starter: false`; a student switches it on in
  Settings › Modules. Switching it off hides it and keeps everything it made. Only Daniel turns a new feature on by
  default.
- **Both apps, one look.** A student feature is built in Sovran Central and in APP Daniel (Daniel's own app, private
  repo `Daniel-Piatek/sovran-advisor`, branch `app-daniel-mac`), with the same screens. Shared files stay identical.
- **The stack stays plain.** Node's own server, SQLite, plain HTML, CSS and JavaScript in `public/`, no framework and no
  build step. A new package (a 3D library, say) needs Daniel's yes first. A library for the page is copied into
  `public/vendor/` by `npm run vendor` (`scripts/vendor.js`), the way the editor's ProseMirror files are.
- **Design rules** are in `AGENTS.md` › Design rules, and `npm test` checks several of them. Every colour, font and size
  comes from `public/tokens.css` (light and dark). Crimson goes on one thing per screen, the main action. Section
  headings are Crimson. Shape tells kinds apart, never colour alone. Surfaces are flat, with no shadows or gradients.
  Ask Daniel before adding a new colour or component. The brand is the Live Sovran Visual Identity Guide v3: White
  #FBFBFB, Charcoal #302D2D, Crimson #C71F42, Gold #D9C14B; Gloock for headings, Plus Jakarta Sans for menus and
  buttons, Inter for reading. Line height 1.44 for body text and 1.36 for short text in cards and captions, never 1.5
  or more. Brand files: repo `Daniel-Piatek/live-sovran-brand`.
- **Data and tests.** A new table goes into `schema.sql` with a raised `SCHEMA_VERSION`, a step in `db.js` that keeps
  every row, and a test. Nothing is ever really deleted (`deleted_at`). Every feature gets unit and browser tests
  (`npm test`). No test uses a real AI model, and any console error fails a test.
- **Explained to students.** Each feature gets a help page in `docs/` and a short voiced film in the app's Tour, laid
  out as `templates/explainer-film/README.md` in the brand repo says. Student instructions show pictures and give the
  exact words to paste.
- **Suggestions pattern.** When the app suggests several things (tags, links), they show as solid chips, each with a
  red × to remove it, and one Accept for what is left.
- **Going live.** Work arrives as a pull request. Nothing merges until Daniel says "merge it". Students then get it
  from Settings › Updates; APP Daniel gets it when Daniel presses Release. Changes to the cloud (Supabase project
  `sovran-library`) are planned so that they need no approval steps from Daniel.

### What has been decided about sharing data between students and Daniel

- **A student's app is theirs alone.** Everything they write is kept on their own computer, with no account and no
  sign-in, and none of it is sent to Daniel. Putting students' data in the cloud behind a sign-in is on the later list
  and is **not decided**.
- **The Sovran Library flows one way, to the student.** With the key Daniel gives them, a student's assistant reads
  Daniel's teaching (shared with every key) and that student's own decodes and reports (only with their key). Birth
  details, session notes, payments and anything from a student's own app stay out of it. Each client's decodes go
  online only after Daniel confirms that client agreed. The library keeps a log of which key asked for what.
- **What a student chooses to send.** Only these leave a student's computer:
  - **Group Circle:** posts, comments, likes and pictures, seen by their Quest group and by Daniel, who can also post
    announcements, hide, pause and read flags.
  - **Tell Daniel:** a report of a problem or question, with what goes with it shown to the student before sending.
  - **go Sovran and saved chats:** sealed with a key only the student's computer (and phone) hold, kept in the cloud
    only until their computer collects them. Daniel cannot read them.
- **Facilitators.** Daniel is the only guide today. His guide rights come from a guide key whose fingerprint is
  registered in the cloud. Nothing has been decided about other facilitators.
