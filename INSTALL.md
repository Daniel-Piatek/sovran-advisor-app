# Installing Sovran Central

This page is written for **Claude** (Claude Code) or, for someone who uses ChatGPT, OpenAI's
**Codex**, which installs Sovran Central for you. You only need to paste this into Claude Code
(or the Codex app) on your computer:

> Install Sovran Central for me by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

**The name:** the app is **Sovran Central** (until 22 Nov 2026 it was called Sovran Advisor, and
"Sovran Advisor" is now the name of the assistant inside it). Its folder keeps its old name,
`Sovran Advisor`, so that updates keep working: never rename the folder. "Update Sovran Advisor" or
"undo the last Sovran Advisor update" from someone with an older copy means the same as with the new name.

**Which AI?** The app's assistant runs on the person's own plan: Claude (Claude Code) or
ChatGPT (Codex). If you are Codex, or the person says they use ChatGPT, follow the ChatGPT
steps marked below; otherwise the Claude ones.

**First, check you are on the person's own computer.** Everything here happens in their home
folder (`~/Sovran Advisor` on a Mac, `%USERPROFILE%\Sovran Advisor` on Windows). If you are
running in a cloud workspace (a Linux machine that is not theirs, such as a Codex cloud task),
you cannot reach it: do nothing, and tell the person in plain words to start you again on their
own computer. The same goes for Claude's ordinary chat or Cowork in the Claude app: they work in a
Linux sandbox and cannot install anything on the person's Windows or Mac. Do not hand the person
Terminal or PowerShell commands to type instead. Tell them, in plain words: open the Claude app,
click **Code** at the top left, start a new session on **This computer** (or pick their Documents
folder), and paste the same sentence again. With Codex: open Terminal (Mac) or PowerShell (Windows), type
`cd ~/"Sovran Advisor"; codex` and press Enter, then paste the same line again. (In the Codex
app instead: start a new chat that works **locally**, not in the cloud, in the Sovran Advisor
folder.) For a first install, `cd ~` instead.

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
   `cd "$HOME/Sovran Advisor" && npm run desktop:build && mkdir -p ~/Applications && cp -R "build/Sovran Central.app" ~/Applications/`.
   This needs the command line developer tools (`xcode-select --install` if `xcrun` is
   missing). Then `open "$HOME/Applications/Sovran Central.app"`. The person can drag the icon
   to the Dock. Opening it the first time also asks the Mac to look after the app (`scripts/login-agent.js`):
   from then on it starts when the person logs in, stops when they log out, and starts again if it ever
   stops. macOS may show a notice "Background Items Added" for Sovran Central: tell the person that is
   expected and to leave it allowed in System Settings › General › Login Items. (Without it, the icon
   still opens the app, the old way.)
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
   it is ready, and that their notes stay on this computer. Tell them too that if the assistant
   ever doesn't answer, Settings › Your assistant's AI › **Check** says why and what to do.

### On Windows

Windows has not been fully tested yet; if a step fails, tell the person plainly and suggest they
post a screenshot in the Sovran WhatsApp group.

0. **Check the computer can run it.** It needs Windows 10 (version 1809 or later) or Windows 11,
   64-bit. Run `[Environment]::OSVersion.Version` and `[Environment]::Is64BitOperatingSystem`
   (build 17763 or higher, and `True`). If it is older (Windows 7 or 8) or 32-bit, stop and tell
   the person kindly that this computer is too old for Sovran Central, and that nothing was changed.
   Then check `winget --version`. If it does not answer (older Windows 10 copies often lack it),
   do not try to repair it: use the installer downloads in steps 1 and 2 instead.
1. **Node.js 22.13 or newer:** `node -v`; if missing or older, `winget install OpenJS.NodeJS.LTS`.
   Without winget: open https://nodejs.org/en/download for the person (`start https://nodejs.org/en/download`);
   they press the **Windows Installer (.msi)** button, open the file, and press Next until Finish.
   Open a new PowerShell window afterwards.
2. **Git** (the app also needs it later, to update itself): `git --version`; if missing,
   `winget install Git.Git`. Without winget: `start https://git-scm.com/download/win`; the person
   downloads the 64-bit installer, opens it, and presses Next until Finish (the default choices are
   fine). Open a new PowerShell window afterwards. Then **download the app** into
   `%USERPROFILE%\Sovran Advisor`:
   `git clone https://github.com/Daniel-Piatek/sovran-advisor-app.git "$env:USERPROFILE\Sovran Advisor"`.
3. **Install what it needs:** `cd "$env:USERPROFILE\Sovran Advisor"; npm.cmd install --omit=dev`.
   (Use `npm.cmd`, not `npm`: on many Windows computers PowerShell refuses `npm` with "running
   scripts is disabled on this system". Do not change the person's execution policy for this.)
4. **A desktop shortcut** to `start-windows.cmd` in that folder, named "Sovran Central", with
   the app's icon:
   ```powershell
   $s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:USERPROFILE\Desktop\Sovran Central.lnk")
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

## For Claude or Codex: using it on a phone (optional: "set up Sovran Central on my phone")

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
8. **A Capture icon too (optional, two taps to the Inbox).** If the person switches on **Phone,
   backups and moving** in Settings › Modules, the phone can also open `https://<the name>/quick`
   (with `:8443` if used) and Share › **Add to Home Screen** a second time: that icon opens straight
   into a box that keeps one thought in the Inbox. While the computer is asleep, what they type stays
   on the phone and is sent when it wakes.
9. Tell the person: the computer must be on and awake. On a Mac, System Settings › Energy (or
   Battery › Options) › "Prevent automatic sleeping when the display is off" keeps it reachable.

**Speaking instead of typing.** Two ways, both optional:
- Free, nothing to set up: the microphone key on the phone's own keyboard works in every field.
- The app's **Dictation** (Settings › Modules): on a computer, hold a key and speak; on a phone,
  tap "Tap to dictate" at the foot of the page, speak, tap Done. It is free: a voice model
  (Whisper) runs on their own computer, fetched once (about 200 MB) when Dictation is first
  switched on, and their voice never leaves the computer. Optional: their own ElevenLabs key
  (paste it into Settings › Dictation) shows the words while they speak; the key stays on their
  computer.
- **Calls with the assistant** (with Dictation on): press Call in the Assistant's chat, talk,
  and it answers out loud; every turn is kept in the chat. Free: it listens with the same voice
  model and speaks with a free voice (Alba, British English, about 70 MB, fetched once the first
  time the chat opens). With an ElevenLabs key, calls listen and speak with ElevenLabs instead.

## For Claude or Codex: moving it to a new computer (optional: "move Sovran Central to my new computer")

Only when the person asks. Nothing goes through a cloud account.

1. **On the old computer**, in the app: Settings › Modules › switch on **Phone, backups and
   moving**, then Settings › Phone, backups and moving › **Make a moving file**. It downloads one
   file, `sovran-advisor-move-<date>.tar.gz`, with everything they wrote and their pictures and files.
2. The person copies that file to the new computer (a USB stick, AirDrop, or their cloud drive).
3. **On the new computer**: install Sovran Central as above. Then in the app, switch on the same
   module and choose **Bring in a moving file**. The app checks the file and shows what it holds;
   nothing changes until the person presses **Replace everything here with it**. The app restarts,
   and what was there before is kept, whole, in `data/before-move-<time>/`.
4. Not in the file, so set again on the new computer if they were used: the phone link (above),
   an ElevenLabs key, and capture devices (Settings › Capture from anywhere).

## For Claude or Codex: updating it ("update Sovran Central")

The person can also update with one button: Settings › Updates › **Update now** (`app-update.js`, the same steps
as below, done by the app). You are here because they chose you, or the button sent them (a clash with their own
change, a copy installed from a zip, or another problem). Its copy of their notes is in
`data/backups/before-update-<time>.db`, and `data/update.json` says what it last did.

The person may have changed their own copy (see `CUSTOMISING.md`). Their changes must survive
the update. Never use `git reset --hard`, `git checkout -- <file>`, `git stash drop`,
`git clean` or a fresh download over the folder to get past a problem, unless the person has
said yes to losing that exact change.

1. Stop the app: in its folder, `npm run stop` (quitting the Mac icon closes the icon only; the
   app keeps running until it is stopped). On a Mac it stays stopped until the icon is opened again
   or the person logs in again. On Windows, closing its black window stops it too.
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
   **The new name (22 Nov 2026):** if `~/Applications/Sovran Advisor.app` is there, build the icon
   again (step 4 above), which makes `Sovran Central.app`, then move the old `Sovran Advisor.app` to
   the Trash (it is only the old icon; nothing of theirs is in it). Tell the person to drag the new
   icon into their Dock, and to remove the old one from the Dock if it still shows. On Windows, if the
   desktop shortcut is still called "Sovran Advisor", rename it "Sovran Central".
6. Start it again (on a Mac: open the icon, which also sets up or refreshes its start at log-in) and check that the person's own changes still work. A database from an older
   version is upgraded by the app itself, after it keeps a whole copy next to it; there is also a
   daily copy in `data/backups/`.

**To undo an update** ("undo the last Sovran Central update"): stop the app and run
`git reset --hard before-update-YYYY-MM-DD` with the latest such tag, after saying in one
sentence that this puts the app's files back as they were before that update (their notes are
not touched). If the update upgraded the database, tell the person before going back, because
the older version may not open the newer database: the copy it kept is
`data/app.db.before-v<N>.bak`.

**Installed from a zip (no `.git` folder in the app's folder):** never download again over it: that
would wipe the person's changes. Make it a git copy in place instead; this changes none of its files.
(Versions from 18 Nov 2026 on do this themselves at Settings › Updates › Check for updates; `adoptZipCopy`
in `app-update.js`.) If `git --version` does not answer, install git first (Mac: `xcode-select --install`;
Windows: https://git-scm.com).
1. In the app's folder: `git init -q`, `git symbolic-ref HEAD refs/heads/main`,
   `git config core.fileMode false`,
   `git remote add origin https://github.com/Daniel-Piatek/sovran-advisor-app.git`, then add the lines
   `data/`, `node_modules/`, `build/` and `MY-CHANGES.md` to `.git/info/exclude`, and
   `git fetch origin main`.
2. Find the version its files came from: `git add -A`, `T=$(git write-tree)`, then compare `$T` with
   `git log --first-parent --format='%H %T' origin/main`. A matching tree is that version. If none
   matches, take the one with the fewest lines apart (`git diff --numstat $T <commit>`); on a tie, the
   older one.
3. `git update-ref refs/heads/main <that commit>` and `git reset -q` (only git's own list changes,
   no file). `git status` now shows the person's own changes, if any.
4. Go on with step 1 of updating above. From now on the Update button works by itself.

Never touch the `data/` folder: it is the person's own notes, journal and people.
