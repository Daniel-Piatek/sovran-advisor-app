# Installing Sovran Advisor

This page is written for **Claude** (Claude Code) or, for someone who uses ChatGPT, OpenAI's
**Codex**, which installs Sovran Advisor for you. You only need to paste this into Claude Code
(or the Codex app) on your computer:

> Install Sovran Advisor for me by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

**Which AI?** The app's assistant runs on the person's own plan: Claude (Claude Code) or
ChatGPT (Codex). If you are Codex, or the person says they use ChatGPT, follow the ChatGPT
steps marked below; otherwise the Claude ones.

---

## For Claude or Codex: how to install it

Work through the steps for the person's computer. Explain each step in a sentence before you
run it, in plain words (the person is not a programmer). When a step needs the person (a
password, an installer window, a sign-in), say exactly what they will see and what to press.

Two steps run code that was just downloaded (`npm install`, which prepares the editor's files,
and building the Mac app icon). If your permission settings stop you there, tell the person
in one sentence what the step does and ask them to approve it; or give them the exact command
to paste into Terminal (Mac) or PowerShell (Windows) themselves.

### On a Mac

1. **Node.js 22.13 or newer.** Run `node -v`. If it is missing or older: with Homebrew
   (`brew -v` answers), run `brew install node`; otherwise download the macOS installer (the LTS
   `.pkg`) from https://nodejs.org and open it, and the person clicks through it.
2. **Download the app** into `~/Sovran Advisor`:
   `git clone https://github.com/Daniel-Piatek/sovran-advisor-app.git "$HOME/Sovran Advisor"`.
   If macOS asks to install the command line developer tools for `git`, the person presses
   Install and you continue when it is done. (Without git: download
   https://github.com/Daniel-Piatek/sovran-advisor-app/archive/refs/heads/main.zip and unzip it
   to `~/Sovran Advisor`; see "Installed from a zip" under updating.)
3. **Install what it needs:** `cd "$HOME/Sovran Advisor" && npm install --omit=dev`.
4. **The app icon**, from the app's folder:
   `cd "$HOME/Sovran Advisor" && npm run desktop:build && mkdir -p ~/Applications && cp -R "build/Sovran Advisor.app" ~/Applications/`.
   This needs the command line developer tools (`xcode-select --install` if `xcrun` is
   missing). Then `open "$HOME/Applications/Sovran Advisor.app"`. The person can drag the icon
   to the Dock.
5. **The assistant** runs on the person's own Claude Code, signed in with their own Claude
   account. Check `claude --version` answers in a new Terminal window. If it does not, install
   Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) and have the person sign in
   once by running `claude`.
   **ChatGPT instead:** check `codex --version` answers. If not, install Codex
   with `npm install -g @openai/codex` (this puts it next to Node.js, where the app icon finds
   it)
   and have the person run `codex` once and choose **Sign in with ChatGPT** (never an API key;
   a Plus plan or higher is best, Free and Go are for light use). Then open the app's
   Settings › Your assistant's AI and press **ChatGPT**, or set it for them:
   `curl -s -X PUT http://127.0.0.1:3300/api/assistant/ai -H 'Content-Type: application/json' -d '{"provider":"codex"}'`.
6. **Check it:** the app opens at http://127.0.0.1:3300 on its welcome screen. Tell the person
   it is ready, and that their notes stay on this computer.

### On Windows

1. **Node.js 22.13 or newer:** `node -v`; if missing or older, `winget install OpenJS.NodeJS.LTS`
   (or the Windows installer from https://nodejs.org). Open a new PowerShell window afterwards.
2. **Download the app** into `%USERPROFILE%\Sovran Advisor`: with git
   (`winget install Git.Git` if missing),
   `git clone https://github.com/Daniel-Piatek/sovran-advisor-app.git "$env:USERPROFILE\Sovran Advisor"`.
3. **Install what it needs:** `cd "$env:USERPROFILE\Sovran Advisor"; npm install --omit=dev`.
4. **A desktop shortcut** to `start-windows.cmd` in that folder, named "Sovran Advisor", with
   the app's icon:
   ```powershell
   $s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:USERPROFILE\Desktop\Sovran Advisor.lnk")
   $s.TargetPath = "$env:USERPROFILE\Sovran Advisor\start-windows.cmd"
   $s.WorkingDirectory = "$env:USERPROFILE\Sovran Advisor"
   $s.IconLocation = "$env:USERPROFILE\Sovran Advisor\public\icons\favicon.ico"
   $s.Save()
   ```
   Double-clicking it starts the app and opens it in the browser. The black window that opens
   with it must stay open while the app is used; closing it stops the app.
5. **The assistant:** as on a Mac, `claude --version` must answer. If not, install Claude Code
   (`irm https://claude.ai/install.ps1 | iex` in PowerShell) and have the person sign in once by
   running `claude`.
   **ChatGPT on Windows is not ready yet** (it has not been tested there). Tell the person
   plainly; everything else in the app works, and the assistant can wait or use Claude.
6. **Check it:** the app opens at http://127.0.0.1:3300 on its welcome screen.

Google Calendar's sign-in needs the macOS keychain, so on Windows it stays off. Everything
else works the same.

## For Claude or Codex: using it on a phone (optional: "set up Sovran Advisor on my phone")

Only when the person asks. The app stays on their computer; their phone reaches it through
**Tailscale**, a free private link between their own devices (nobody else can get in). It works
while the computer is switched on and awake.

1. **Tailscale on the computer.** Mac: `brew install --cask tailscale`, or the installer from
   https://tailscale.com/download. Windows: `winget install --id tailscale.tailscale -e`. Open it
   and have the person sign in (Google, Apple or Microsoft account are all fine).
2. **Tailscale on the phone.** The person installs "Tailscale" from the App Store or Google Play
   and signs in with the **same** account. Wait until `tailscale status` lists the phone.
3. **Look first.** Run `tailscale serve status`. If something is already served there, it is
   another app of the person's: never change or reset it, and use port 8443 below.
4. **Pass the app on, privately, with https** (the phone's microphone needs https):
   `tailscale serve --bg 3300`, or `tailscale serve --bg --https=8443 3300` when step 3 found
   something. If it answers with a link to switch on HTTPS (or MagicDNS), the person opens it,
   presses the button, and you run the command again. On a Mac the command may be at
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale` instead of `tailscale`.
5. **Tell the app its private name.** The name is `Self.DNSName` in `tailscale status --json`,
   without the dot at the end (for example `annes-mac.tail1234.ts.net`). Write it as one line in
   `data/hosts.txt` in the app's folder; with port 8443 write `annes-mac.tail1234.ts.net:8443`.
   This is the only thing ever written into `data/`; the app refuses any name not listed there.
6. **Restart the app** (`npm run stop`, then open it from its icon; on Windows close the black
   window and double-click the shortcut). Check: `curl -s https://<the name>/api/health` (add
   `:8443` if used) answers from this computer.
7. **On the phone:** open `https://<the name>` (with `:8443` if used) in Safari or Chrome, then
   Share › **Add to Home Screen**. From then on it opens like an app.
8. Tell the person: the computer must be on and awake. On a Mac, System Settings › Energy (or
   Battery › Options) › "Prevent automatic sleeping when the display is off" keeps it reachable.

**Speaking instead of typing.** Two ways, both optional:
- Free, nothing to set up: the microphone key on the phone's own keyboard works in every field.
- The app's **Dictation** (Settings › Modules): on a computer, hold a key and speak; on a phone,
  tap "Tap to dictate" at the foot of the page, speak, tap Done. It uses ElevenLabs speech to
  text, so the person needs their own ElevenLabs account and key (paste it into Settings ›
  Dictation). The key stays on their computer.

## For Claude or Codex: updating it ("update Sovran Advisor")

The person may have changed their own copy (see `CUSTOMISING.md`). Their changes must survive
the update. Never use `git reset --hard`, `git checkout -- <file>`, `git stash drop`,
`git clean` or a fresh download over the folder to get past a problem, unless the person has
said yes to losing that exact change.

1. Stop the app: in its folder, `npm run stop` (quitting the Mac icon closes the icon only; the
   app keeps running until it is stopped). On Windows, closing its black window stops it too.
2. **Keep the person's changes.** In the app's folder, run `git status`. If files the app came
   with are changed or new files are there (`data/` never shows: it is left out of git), first
   check that `MY-CHANGES.md` lists them and add what is missing (if that file is not there yet,
   because the copy is older than it, write it after step 4 instead). Then save the changes as
   their own step: `git add -A -- . ':!MY-CHANGES.md'` and
   `git commit -m "My own changes before the update of YYYY-MM-DD"`. If `git config user.name`
   answers nothing in this folder, first set a name for this folder only:
   `git config user.name "<their name>"` and `git config user.email "sovran@localhost"`.
3. **Mark the spot:** `git tag before-update-YYYY-MM-DD` (add `-2` if that tag is there), so the
   whole update can be undone.
4. **Bring in the new version:** `git pull --no-rebase --no-edit origin main`, then `npm install --omit=dev`.
   - If git says it **merged** or **fast-forwarded**, go on.
   - If git reports a **CONFLICT**, stop. For each clash, tell the person in plain words what
     their change was (from `MY-CHANGES.md`) and what the new version changes in the same place.
     Offer: keep mine, take the new one (then make their change again on top, if they want),
     combine them (show the result before saving), or not now (`git merge --abort`, which puts
     everything back as it was). Wait for their answer, then finish with `git commit`.
5. On a Mac, rebuild the icon (step 4 above) if the update notes say so, and also after Node.js
   was upgraded or moved (for example by `brew upgrade node`): the icon remembers where Node.js
   was when it was built, and does not start without it.
6. Start it again and check that the person's own changes still work. A database from an older
   version is upgraded by the app itself, after it keeps a whole copy next to it; there is also a
   daily copy in `data/backups/`.

**To undo an update** ("undo the last Sovran Advisor update"): stop the app and run
`git reset --hard before-update-YYYY-MM-DD` with the latest such tag, after saying in one
sentence that this puts the app's files back as they were before that update (their notes are
not touched). If the update upgraded the database, tell the person before going back, because
the older version may not open the newer database: the copy it kept is
`data/app.db.before-v<N>.bak`.

**Installed from a zip (no git):** downloading again would wipe the person's changes. Download
the new zip into a new folder, move `data/` and `MY-CHANGES.md` across into it, make the changes
listed in `MY-CHANGES.md` again, and keep the old folder, renamed `Sovran Advisor (before
update)`, until the person says all is well. Better still, offer to install git first and use it
from then on.

Never touch the `data/` folder: it is the person's own notes, journal and people.
