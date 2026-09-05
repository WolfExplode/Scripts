@echo off
rem Starts the TierForge helper and opens the app in your browser.
rem The helper serves the page and does TierMaker imports for it, which is the
rem only import path that isn't at the mercy of Cloudflare or a public proxy.
cd /d "%~dp0"
python scrape_tiermaker.py --serve %*
if errorlevel 1 (
  echo.
  echo Could not start. Is Python on your PATH?  Try:  py scrape_tiermaker.py --serve
  pause
)
