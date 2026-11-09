@echo off
rem Sovran Advisor for Windows: starts the app and opens it in your web browser.
rem Keep this window open while you use the app; close it to stop the app.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Ask Claude: "install Node.js for Sovran Advisor". & pause & exit /b 1)
if not exist node_modules (call npm install --omit=dev)
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:3300"
node server.js
