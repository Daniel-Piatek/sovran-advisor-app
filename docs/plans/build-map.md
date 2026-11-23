# How Sovran Central is built (handover, 23 Nov 2026)

Checked today against GitHub, Daniel's Mac mini and Supabase. Names: student app = **Sovran Central**; its in-app assistant = **Sovran Advisor**; phone page = **go Sovran**; Daniel's own app = **APP Daniel**. Old names stay in folders, repos and ids on purpose (renaming would break installs).

There is no Sovran Compass or Meta Framework code anywhere yet (it is only on Daniel's "later" list), and nothing 3D.

## 1. GitHub repos

| Repo | What it holds |
|---|---|
| `Daniel-Piatek/sovran-advisor-app` (public) | **Sovran Central** (student desktop app), branch `main`. Also `phone/` = **go Sovran** phone page, published by GitHub Pages (`.github/workflows/phone-page.yml`) at https://daniel-piatek.github.io/sovran-advisor-app/. Also `cloud/` = source of the Supabase functions and SQL the student side uses (phone-drop, group-feed, tag-pictures, library-save, group alerts/push, tell-daniel). |
| `Daniel-Piatek/sovran-advisor` (private) | **APP Daniel**, Daniel's own bigger version of the same app. Live branch is `app-daniel-mac` (not `main`). `scripts/cloud/` holds Daniel-only cloud parts (daniel-mcp, app-sync, inbox-pull, estate-sync, client-upload). |
| `Daniel-Piatek/sovran-machine` (private) | Decode/report machine (Python, `machine/`) and the **Sovran Library** MCP server source: `machine/supabase/library-mcp/` (`index.ts`, `core.js`), plus report-ingest. The live library code is on branch `claude/project-thread-peb7rc` / `claude/project-thread-wmrock`, not `main`. |
| `Daniel-Piatek/live-sovran-brand` (private) | Brand library: colours, fonts, logos, images, templates. Start at `README.md`, rules in `AGENTS.md`, `BRAND.md` quick facts. Film rules: `templates/explainer-film/README.md`. Mirror only: edit on the Mac copy. |

## 2. Folders on Daniel's Mac 

| Folder | What it is | On GitHub? |
|---|---|---|
| `~/Sovran Advisor` | Daniel's workshop copy of Sovran Central (clone of sovran-advisor-app, `main`), runs at http://127.0.0.1:3300. Students install to the same folder name. | Yes (code). `data/` is Mac only. |
| `~/APP Daniel` | APP Daniel, runs at http://127.0.0.1:3000. Local branch `main`; its only remote is called `backup` and points at sovran-advisor `app-daniel-mac`. | Yes (code). `data/` Mac only. |
| `~/Sovran Machine` | Working copy of sovran-machine. | Code yes; `clients/`, `private/` Mac only. |
| `~/Live Sovran Brand` | The brand folder, the single source of truth. | Mirrored to live-sovran-brand. |
| `~/Live-Sovran-Platform` | Separate public course website (Next.js 15 + Supabase + Mux), branch `draft/mini-course-2026-09-30`. Not part of Sovran Central. | **Mac only** (git, no remote). |
| `~/APP Daniel Restore Points` | Saved copies of APP Daniel. | **Mac only**. |
| `~/PKA-Live-Sovran` | The old estate. Read only, never write. | Mac only. |

Never commit or read anything in `data/`, `clients/`, `private/` or `~/Client Folders`.

## 3. How the parts talk

- **Sovran Central** is a local Node server on the student's computer, `127.0.0.1:3300` (APP Daniel uses 3000; demo copy 3310). It only answers that computer. All data is one SQLite file, `data/app.db`.
- **Sovran Advisor** (assistant) = the student's own `claude` command (Claude Code) or OpenAI Codex, started by the app. The app gives it its own tools over MCP at `/api/mcp` (`mcp.js`, `assistant-tools.js`), guarded by a secret.
- **Supabase project `sovran-library`** (ref `lpqzqnmwsxnojvpcqwiy`, eu-central-1) is the one shared cloud. Edge functions live now: `library-mcp` (v8), `library-mcp-next`, `phone-drop`, `group-feed`, `tag-pictures`, `report-ingest`, `daniel-mcp`, `app-sync`, `inbox-pull`, `client-ingest`, `estate-ingest`.
- **Sovran Library** MCP connector = `https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/library-mcp`. Students paste a library key in Settings; the app (`sovran-library.js`) then adds the library tools to the assistant. Students can also add it as a connector in Claude/ChatGPT; its `save_to_my_sovran_advisor` tool sends a sealed chat copy back to their computer.
- **go Sovran phone page** (static PWA on GitHub Pages) never talks to the computer directly: it seals each item with a key only the phone and computer share and drops it in the `phone-drop` function's box; the computer collects about once a minute (`phone-drop.js`), then the box deletes it. Group Circle and reports go through `group-feed` and the library key the same way.
- **APP Daniel** syncs Daniel's own data to the cloud nightly (`app-sync`) for the private **Daniel App** connector (`daniel-mcp`).
- A separate Supabase project `live-sovran-platform` belongs only to the course website.

## 4. Tech stack and install

- Node 22.13+, Node's built-in `http` (no framework) in `server.js`; SQLite via `node:sqlite`; tables in `schema.sql`, upgraded by `db.js`.
- Front end: plain HTML/CSS/JS in `public/`, **no framework, no build step**; design tokens in `public/tokens.css` (light + dark). Editor = ProseMirror (vendored into `public/vendor/` by `npm run vendor`). Only other dependency `ical.js`. New dependencies need Daniel's yes (`AGENTS.md`).
- Features are modules switched on in Settings › Modules (`modules.js`), off by default for new features.
- Tests: `npm test` (Node test runner + Playwright). Mac launcher `scripts/DesktopLauncher.swift`, login agent `scripts/login-agent.js`; Windows `start-windows.cmd`.
- **Install:** the student pastes into Claude Code (or Codex): "Install Sovran Central for me by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md". Updates: Settings › Updates (`app-update.js`) or "update Sovran Central". Needs a paid Claude plan (or ChatGPT plan with Codex).
- Phone: open the go Sovran link from Settings on the phone and add it to the home screen. Changes to `phone/` go live on merge to `main`.

## 5. Design notes and handover docs

- Sovran Central repo: `README.md` (what it does), `AGENTS.md` (stack, design and working rules: read first), `SPEC.md`, `INSTALL.md`, `CUSTOMISING.md`, `docs/*.md` (in-app help per page).
- APP Daniel: `README.md`, `AGENTS.md`, `SPEC.md`, `HANDOFF-CODEX.md` (dated 28 Oct, partly out of date).
- sovran-machine: `README.md`, `CLAUDE.md`, `machine/PHASE-B.md`.
- Brand: `~/Live Sovran Brand` (README, AGENTS, BRAND.md); Visual Identity Guide v3 PDF in Daniel's project files.
- Daniel's project files (Daniel's Claude project): `system-map/system-map.html`, `phone-app-plan/phone-app-plan.html`, `library-plan/library-plan.html`, `student-guide/` (Start Here page, tour films), `later-list/later-list.md`. Copies of these are now in this folder, `docs/plans/`.
- Course website design notes: `~/Live-Sovran-Platform/docs/` (ADRs, `DATA-MODEL.md`, `design/`).
