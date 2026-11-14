# COSMIC PREDICT — SPHEREx Time-Domain Explorer

A public-facing web tool for NASA Space Apps Challenge 2026 ("[Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)").
Enter sky coordinates and replay real SPHEREx observations of that spot like a
short film: blink between dates to catch moving objects, run noise-aware change
detection, and plot the spot's brightness over time. Everything shown is real
archive data or clearly labeled as derived/synthetic.

Independent hackathon entry, not an official NASA product. SPHEREx data courtesy
NASA/JPL-Caltech/IPAC-IRSA.

## Run the app locally

Backend requires Python 3.11+; frontend requires Node 20+.

### Linux / macOS

```bash
# one-time setup
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env   # optionally fill in Supabase credentials
cd frontend && npm install && cd ..

# terminal 1 — backend (run from the repository root, not from backend/)
source .venv/bin/activate
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

# terminal 2 — frontend
cd frontend && npm run dev
```

### Windows (PowerShell)

```powershell
python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
# second terminal:
Set-Location frontend; npm install; npm run dev
```

Open <http://localhost:3000>. The frontend proxies `/api/*` to the backend
(override with the `BACKEND_URL` env var). Views are shareable via URL:
`http://localhost:3000/?ra=269.454&dec=4.693`.

## Getting observation data

The app needs SPHEREx FITS images locally (or via the team Supabase). Three ways:

1. **In-app, on demand (easiest).** Enter any coordinates; when nothing is
   cached, click **"Search the NASA archive"**. The backend queries IRSA and
   downloads small server-side *cutouts* (a few MB per epoch instead of the
   full 65 MB products) into `data/raw/`. Takes about a minute per new region.

2. **Bulk pre-fetch of the challenge's five test targets** (recommended before
   a demo; ~2.2 GB, 30–60 min):

   ```bash
   python scripts/scrape_timeline.py            # all five targets
   python scripts/scrape_timeline.py --dry-run  # show the plan first
   python scripts/scrape_timeline.py --targets "R Draconis" --upload
   ```

   The script samples one well-centered image per month per target in the
   best-covered detector band. It is idempotent — already-downloaded files are
   skipped — so every teammate can run it on their own machine. `--upload`
   additionally pushes compact snapshots to the team Supabase (mind the
   storage quota; see below).

3. **Team Supabase.** With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set in
   `backend/.env`, the backend lists the shared catalog and downloads snapshots
   on demand, caching them locally. Without credentials it falls back to
   whatever is in `data/raw/` — the demo works fully offline from local files.

Observation data lives in `data/` and is **git-ignored — never commit FITS or
snapshot files**.

## Configuration (`backend/.env`)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Team catalog/storage (optional; local fallback otherwise) |
| `SUPABASE_BUCKET` | Storage bucket, default `spherex-images` |
| `SPHEREX_SIA_URL` | IRSA SIA v2 endpoint. **Collections change between releases**: `spherex_qr2` was retired (queries return 0 rows); current ones are `spherex_qr3` (rolling quick release) and `spherex_dr1` (year-1 release) |
| `DATA_RAW_DIR` | Local FITS cache, default `data/raw` |
| `CORS_ORIGINS` | Comma-separated allowed origins (default `*`) |

## API overview

| Route | Purpose |
|---|---|
| `GET /api/health` | Service status, active data provider, observation count |
| `GET /api/timeline?ra&dec&fov&band` | Chronological same-band observations whose footprint contains the position, with per-frame coverage and a locked brightness scale |
| `GET /api/cutout/{id}?ra&dec&fov&size&vmin&vmax` | North-up WCS-aligned cutout PNG — every epoch lands on the same sky grid |
| `POST /api/analyze_region` | Noise-normalized change detection on the aligned cutout grid; returns ≥5σ candidate regions with caveats |
| `GET /api/diff/aligned?...` | Difference image (red = brighter in A, blue = brighter in B) |
| `GET /api/spectrum?ra&dec` | Brightness of the position in every covering observation (peak minus background) — powers the light-curve panel |
| `GET /api/gaia?ra&dec&fov` | Known ESA Gaia DR3 stars inside the aligned frame, with in-frame positions for the overlay (live TAP query, disk-cached for offline demos) |
| `GET /api/feed` | Scrollable tiles for the Sky Scroll reel view — real positions whose footprints verifiably contain ≥2 epochs of one band |
| `GET/POST /api/marks`, `DELETE /api/marks/{id}` | User "suspicious" flags (personal bookmarks, stored in `data/marks.json`); a tapped in-frame spot is converted to sky coordinates server-side |
| `POST /api/fetch_region?ra&dec` | Start a background fetch of time-spread cutouts from the live IRSA archive (bounded, polite, ledgered). Answers immediately; poll the same request until `status` is `already_fetched` or `failed` |
| `GET /api/epochs`, `GET /api/images`, `POST /api/diff`, `POST /api/analyze` | Legacy whole-image routes (unaligned; kept for compatibility) |

## Architecture

- `frontend/` — Next.js + React + MUI. Epoch player with blink mode, A/B
  comparison with candidate overlays, light-curve panel, optional 3-D view.
  `/scroll` is **Sky Scroll**: a reels-style vertical feed that auto-replays
  real multi-epoch tiles; tap a spot to pin it and flag it as suspicious.
  `/flags` is the review queue for everything flagged. No FITS parsing or
  science in the browser.
- `backend/astronomy/` — FITS loading with quality masks (`fits_loader`),
  WCS-aligned north-up cutouts (`cutout`), uncertainty-aware difference imaging
  (`difference`), display rendering (`render`).
- `backend/storage/` — Supabase-first catalog with local filesystem fallback
  (`local` keeps sidecar metadata caches next to each FITS), plus on-demand
  IRSA cutout retrieval (`live_archive`).
- `backend/api/routes.py` — thin HTTP layer over the above.
- `scripts/` — bulk scraping and preprocessing utilities.

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The suite builds synthetic FITS fixtures with known WCS rotations/offsets and an
injected moving source, then verifies that alignment lands a fixed star on the
same pixel across epochs, the mover is detected at >5σ, and the fixed star is
not flagged.

## NASA data & resources — how each one is used

This project is an entry to the [NASA Space Apps Challenge 2026 — Planet X and
SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/?tab=resources).
Every resource below is *integrated*, not just cited:

- [SPHEREx data at NASA/IPAC IRSA](https://irsa.ipac.caltech.edu/Missions/spherex.html)
  ([DOI 10.26131/IRSA652](https://doi.org/10.26131/IRSA652)) — the primary
  dataset. Every frame in the app is a real Level-2 SPHEREx image, queried
  live through the [IRSA SIA API](https://irsa.ipac.caltech.edu/docs/program_interface/api_images.html)
  and downloaded as server-side cutouts (`backend/storage/live_archive.py`).
- [SPHEREx tutorial notebooks](https://caltech-ipac.github.io/irsa-tutorials/) —
  the documented Python access patterns (SIA discovery + IBE `?center&size`
  cutouts) that our on-demand fetch pipeline follows.
- [ESA Gaia Mission Data (DR3)](https://gea.esac.esa.int/archive/) — actively
  queried via TAP (`backend/storage/gaia.py`). Powers two features: the
  **known-star overlay** in the player (ring every catalogued star, so a
  changing dot *without* a ring is immediately interesting), and the
  **candidate cross-match** — every flagged change is automatically checked
  against Gaia DR3 and labelled "known star" (with magnitude, proper motion
  and variability flag) or "not in star catalog". A faint solar-system body —
  a Planet X — would not be in Gaia's optical catalog; that is the point of
  the check. Results are disk-cached so demos work offline.
- [WiseView](http://byw.tools/wiseview) (NASA WISE) — the public-discovery
  tool this app is modelled on, and an active verification step: every
  candidate's detail panel deep-links to WiseView at the candidate's exact
  coordinates, so users can blink 10+ years of WISE infrared imagery to
  confirm or reject slow movers.
- [NASA SPHEREx mission](https://science.nasa.gov/mission/spherex/) — mission
  facts in the public-facing explainer.
- [Astropy](https://www.astropy.org/) (`astropy.io.fits`, `astropy.wcs`,
  `astropy.visualization`) — FITS parsing, WCS alignment, display stretches.

Data acknowledgment: SPHEREx data courtesy NASA/JPL-Caltech/IPAC-IRSA; Gaia
data from ESA's Gaia mission, processed by DPAC. This is an independent
project, not affiliated with or endorsed by NASA or ESA.

## Scientific integrity

Real SPHEREx observations are the only analysis input. Flagged regions are
**unclassified candidates**, never confirmed detections. Cutouts are bilinearly
resampled for alignment (display-grade, not precision photometry). Synthetic
blends are labeled and excluded from analysis. SPHEREx detectors are
linear-variable filters, so the same position may be sampled at slightly
different wavelengths on different visits. Full rules: `AGENTS.md`, `CLAUDE.md`.

## Team operations

- **Weekly scrape Action** (`.github/workflows/scrape.yml`) runs
  `scripts/scrape.sh` → Supabase every Sunday. It reads the repo secret
  `SPHEREX_SIA_URL`, which still points at the retired `spherex_qr2`
  collection — IRSA answers "OK, 0 rows", so the pipeline collects nothing.
  Fix: repo **Settings → Secrets and variables → Actions → `SPHEREX_SIA_URL` →
  set to** `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr3`
  (or delete the secret — the script's default is now correct).
- **Supabase quota**: full-frame snapshots are ~28 MB each; check the project's
  storage plan before bulk `--upload` runs.
