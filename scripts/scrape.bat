@echo off
rem Polite IRSA scraper (Windows): bounded sky grid + sleeps to avoid rate
rem limits / IP bans. Re-running is safe and incremental (existing files are
rem skipped and rows are upserted into Supabase).
setlocal enabledelayedexpansion

if not defined SCRAPE_DELAY set SCRAPE_DELAY=5
if not defined SCRAPE_MAX_RECORDS set SCRAPE_MAX_RECORDS=5
if not defined SCRAPE_SIZE set SCRAPE_SIZE=0.5
if not defined SPHEREX_SIA_URL set SPHEREX_SIA_URL=https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2

echo Scraping with delay=%SCRAPE_DELAY%s, max_records=%SCRAPE_MAX_RECORDS%, size=%SCRAPE_SIZE%deg

for %%R in (0 60 120 180 240 300) do (
  for %%D in (-60 -30 0 30 60) do (
    echo ==^> Position RA=%%R Dec=%%D
    python scripts/scraper.py --ra %%R --dec %%D --size %SCRAPE_SIZE% --max-records %SCRAPE_MAX_RECORDS% --delay %SCRAPE_DELAY% --service-url "%SPHEREX_SIA_URL%"
    if errorlevel 1 echo Warning: scrape failed for RA=%%R Dec=%%D
    echo ==^> Sleeping %SCRAPE_DELAY%s between positions
    timeout /t %SCRAPE_DELAY% /nobreak >nul
  )
)

echo Scrape complete.
endlocal
