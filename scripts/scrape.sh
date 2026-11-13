#!/usr/bin/env bash
# Polite IRSA scraper: loops over a bounded sky grid, small per-query record
# caps, and sleeps between downloads/positions to avoid rate limiting / IP bans.
#
# Tune behaviour via environment variables:
#   SCRAPE_DELAY        seconds between downloads           (default 5)
#   SCRAPE_MAX_RECORDS  max images per sky position         (default 5)
#   SPHEREX_SIA_URL     SIA v2 endpoint                     (default spherex_qr3)
#
# Each invocation skips already-downloaded files and upserts into Supabase, so
# re-running is safe and incremental.
set -euo pipefail

DELAY="${SCRAPE_DELAY:-5}"
MAX_RECORDS="${SCRAPE_MAX_RECORDS:-5}"
SERVICE_URL="${SPHEREX_SIA_URL:-https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr3}"
SIZE="${SCRAPE_SIZE:-0.5}"

# Coarse all-sky grid (RA step 60 deg, Dec step 40 deg). 30 positions keeps
# the run bounded while covering a useful fraction of the sky.
RA_VALUES=(0 60 120 180 240 300)
DEC_VALUES=(-60 -30 0 30 60)

echo "Scraping with delay=${DELAY}s, max_records=${MAX_RECORDS}, size=${SIZE}deg"
for RA in "${RA_VALUES[@]}"; do
  for DEC in "${DEC_VALUES[@]}"; do
    echo "==> Position RA=${RA} Dec=${DEC}"
    python3 scripts/scraper.py \
      --ra "${RA}" \
      --dec "${DEC}" \
      --size "${SIZE}" \
      --max-records "${MAX_RECORDS}" \
      --delay "${DELAY}" \
      --service-url "${SERVICE_URL}"
    echo "==> Sleeping ${DELAY}s between positions"
    sleep "${DELAY}"
  done
done

echo "Scrape complete."
