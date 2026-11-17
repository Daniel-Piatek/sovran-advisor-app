# Keep this chat saved: the Sovran Library's save tool

Two files that become part of **library-mcp** (the Sovran Library's web function, kept in the reports machine's
repository, daniel-piatek/sovran-machine, `machine/supabase/library-mcp/`):

- `save.js`: the tool `save_to_my_sovran_advisor`, the words that tell the AI when to offer saving, and `redactSave`.
- `sealing.js`: sealing to the public key of the student's computer (also used by the app, `phone-drop.js`).

The lines that change in library-mcp's `core.js` are listed at the top of `save.js`. The database side is the last part
of `cloud/phone-drop.sql` (`savers`, `register_saver`, `saver_key`, `save_note`), and the drop box's web function
(`cloud/phone-drop/index.ts`) gains the action `register`.

Order to go live: 1. the SQL, 2. the `phone-drop` function, 3. library-mcp with the two files. Until all three are
live, the app asks to register once an hour and nothing else changes. To go back: redeploy library-mcp without the
tool; the table and functions can stay.

What the cloud holds: the public key, and sealed text that only the student's computer can open. The words pass
through library-mcp's memory while they are sealed; they are never stored or logged readable.
