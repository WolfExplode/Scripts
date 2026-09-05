@echo off
setlocal
rem Starts TierForge's local Node runtime and opens the app in your browser.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo TierForge needs Node.js 20 or newer. Install it from https://nodejs.org/
  pause
  exit /b 1
)
call npm run serve -- %*
if errorlevel 1 (
  echo.
  echo TierForge could not start. Run "npm test" in this folder for diagnostics.
  pause
)
