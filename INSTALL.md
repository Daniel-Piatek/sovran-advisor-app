# Installing Sovran Advisor

This page is written for **Claude** (Claude Code), which installs Sovran Advisor for you.
You only need to paste this into Claude Code on your computer:

> Install Sovran Advisor for me by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md

---

## For Claude: how to install it

Work through the steps for the person's computer. Explain each step in a sentence before you
run it, in plain words (the person is not a programmer). When a step needs the person (a
password, an installer window, a sign-in), say exactly what they will see and what to press.

### On a Mac

1. **Node.js 22.13 or newer.** Run `node -v`. If it is missing or older: with Homebrew
   (`brew -v` answers), run `brew install node`; otherwise download the macOS installer (the LTS
   `.pkg`) from https://nodejs.org and open it, and the person clicks through it.
2. **Download the app** into `~/Sovran Advisor`:
   `git clone https://github.com/Daniel-Piatek/sovran-advisor-app.git "$HOME/Sovran Advisor"`.
   If macOS asks to install the command line developer tools for `git`, the person presses
   Install and you continue when it is done. (Without git: download
   https://github.com/Daniel-Piatek/sovran-advisor-app/archive/refs/heads/main.zip and unzip it
   to `~/Sovran Advisor`; updates then work the same way, by downloading again.)
3. **Install what it needs:** `cd "$HOME/Sovran Advisor" && npm install --omit=dev`.
4. **The app icon:** `npm run desktop:build`, then
   `mkdir -p ~/Applications && cp -R "build/Sovran Advisor.app" ~/Applications/`.
   This needs the command line developer tools (`xcode-select --install` if `xcrun` is
   missing). Then `open "$HOME/Applications/Sovran Advisor.app"`. The person can drag the icon
   to the Dock.
5. **The assistant** runs on the person's own Claude Code, signed in with their own Claude
   account. Check `claude --version` answers in a new Terminal window. If it does not, install
   Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) and have the person sign in
   once by running `claude`.
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
6. **Check it:** the app opens at http://127.0.0.1:3300 on its welcome screen.

Google Calendar's sign-in needs the macOS keychain, so on Windows it stays off. Everything
else works the same.

## For Claude: updating it ("update Sovran Advisor")

1. Stop the app if it runs (Mac: quit Sovran Advisor; Windows: close its black window).
2. In the app's folder: `git pull`, then `npm install --omit=dev`.
3. On a Mac, rebuild the icon if the update notes say so (`npm run desktop:build` and copy it
   again).
4. Start it again. A database from an older version is upgraded by the app itself, after it
   keeps a whole copy next to it; there is also a daily copy in `data/backups/`.

Never touch the `data/` folder: it is the person's own notes, journal and people. If `git pull`
reports that a file the person changed clashes with the update, stop and explain it to them in
plain words before doing anything else.
