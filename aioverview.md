# Building a SPHEREx Time-Domain Viewer for NASA Space Apps 2026

## 1. Reality Check: What Data Actually Exists (and When)

Before designing the tool, you need to understand the data timeline. SPHEREx launched in March 2025. As of the 2026 hackathon (November 14–15, 2026), the data situation is:

| Data Product | Availability at IRSA | Useful for "Change Over Time"? |
|---|---|---|
| Calibrated Spectral Images (Quick Release) | Within ~60 days of observation, released weekly | **Yes** — you can get multiple epochs of the same sky region |
| Reprocessed Calibrated Images (QR2) | First release ~October 2025 | **Yes** — better quality, same epochs |
| All-Sky Data Cubes (102 bands) | **November 2026** (6 months after year 1 survey) | **Maybe** — depending on exact release timing during the hackathon |
| High Reliability Source Catalog | August 2027 | No |

**Key takeaway:** You will likely be working with **Quick Release spectral images** and possibly the first All-Sky Data Cubes if they drop during the hackathon. The "change over time" is real but limited — SPHEREx surveys the full sky every six months, so between mid-2025 and late 2026 you have roughly 2–3 full-sky epochs for many regions.

---

## 2. Architecture Overview

The system has three layers: a frontend for visualization, a backend for querying and image processing, and a data layer that pulls from IRSA or a local cache.

**Frontend (React/Next.js)**
- Sky Viewer (Aladin Lite or OpenSeaDragon)
- Timeline Slider for epoch selection
- Object Diff Panel for change detection

**Backend (FastAPI or Node.js)**
- `/images?ra=...&dec=...&epoch=...` — fetch image for a sky region at an epoch
- `/objects/{id}/history` — return all epochs for an object
- `/diff?ra1=...&ra2=...&epoch1=...&epoch2=...` — compute difference image
- Caching layer (Redis or filesystem)

**Data Layer**
- IRSA SIA v2 API for live queries
- Your mock/cached dataset (pre-downloaded FITS converted to PNG)

---

## 3. Real APIs You Can Use

### 3.1 IRSA SIA v2 (Primary Image API)

This is the **official, public** way to query SPHEREx images programmatically.

- **Protocol:** Simple Image Access version 2 (IVOA standard)
- **Endpoint base:** IRSA SIA v2 service
- **What you can query:** Position (RA/Dec), waveband, time range
- **Output formats:** FITS, JSON, VOTable, CSV, HTML
- **Python access:** `astroquery.query_sia()`

**Example query concept:**

GET /sia/v2/query?POS=150.0,2.0&FORMAT=JSON&BAND=2.0



### 3.2 IRSA Cloud Data Access (AWS S3)

SPHEREx data is available on AWS Open Data. This is **crucial for a hackathon** because:
- You can pre-download a small subset of images before the event
- You avoid hammering the IRSA API during the competition
- You can serve cached images instantly to the frontend

### 3.3 SPHEREx Data Explorer (Reference)

IRSA provides a user-friendly web app for exploring SPHEREx data. **Study this** — it's the baseline you're improving upon. Your differentiator is the **time-domain visualization** (slider, difference images) that the official explorer may not emphasize.

### 3.4 astroquery (Python)

For the backend, `astroquery.ipac.irsa` provides programmatic access to IRSA services. This is the recommended path for fetching images in your backend code.

---

## 4. Can You Build Your Own Placeholder API?

**Yes, and you should.** Here's why and how:

### Why Build a Mock API

1. **Data gaps:** The All-Sky Data Cubes may not be available during the hackathon. Quick Release images are available, but downloading and processing FITS files takes time.
2. **Demo reliability:** Live API calls during a 48-hour hackathon are risky. A cached/mock layer ensures your demo never fails.
3. **Frontend-first development:** You can build the entire UI without waiting for real data pipelines.
4. **Performance:** Serving pre-processed PNGs from your own API is faster than real-time FITS conversion.

### Mock API Design

The mock API mirrors the real IRSA interface so you can swap data sources without rewriting frontend code. It exposes three endpoints: one for fetching images by sky region and epoch, one for listing available epochs at a position, and one for computing difference images between two epochs.

The image endpoint accepts RA/Dec bounds and an epoch string, returning a JSON object with an image URL and metadata. The epochs endpoint takes a single RA/Dec and returns a list of epochs where data exists. The diff endpoint takes two epochs and returns a difference image URL plus any detected candidate sources.

### How to Populate the Mock

1. **Pre-hackathon:** Download 50–100 SPHEREx Quick Release FITS images covering a few interesting sky regions (e.g., Orion, Galactic center, ecliptic poles).
2. **Process them:** Use `astropy.io.fits` + `matplotlib` to convert to PNGs with proper stretching.
3. **Store metadata:** RA/Dec bounds, epoch, band, file path in a simple SQLite or JSON file.
4. **Serve via FastAPI:** Static file serving + metadata endpoints.

This mock API is **your safety net**. If the real IRSA API works during the hackathon, swap the data source behind the same interface.

---

## 5. Recommended Tech Stack

### Frontend

| Component | Tool | Why |
|---|---|---|
| Framework | **React** or **Next.js** | Fast development, component reuse |
| Sky Viewer | **Aladin Lite** or **OpenSeaDragon** | Aladin is built for astronomy; OpenSeaDragon handles deep zoom |
| Timeline UI | **noUiSlider** or **rc-slider** | Epoch slider |
| Maps/coords | **D3.js** for overlays, or just CSS transforms | Lightweight |

**Aladin Lite** is particularly strong for astronomy: it handles HiPS (Hierarchical Progressive Surveys) and can overlay FITS images. It's what professional astronomy tools use.

### Backend

| Component | Tool | Why |
|---|---|---|
| API Framework | **FastAPI** (Python) | Async, auto-docs, easy FITS processing |
| FITS Processing | **Astropy** + **NumPy** | Standard for astronomy data |
| Image Conversion | **Pillow** or **Matplotlib** | FITS → PNG |
| Caching | **Redis** or just local filesystem | Hackathon-friendly |
| Database (optional) | **SQLite** | Zero-config metadata store |

### Difference Imaging (for transient detection)

If you want to show "what changed," you need **image subtraction**:

1. **Align** two epochs (astrometric matching)
2. **PSF-match** the images (blur the sharper one)
3. **Subtract** and look for residuals

For a hackathon, you can use **HOTPANTS** (a standard astronomy tool) or write a simplified version using NumPy array subtraction after normalization.

The limitation is real: proper image subtraction requires careful PSF matching and alignment. For a hackathon demo, a **"blink comparator"** (toggle between epochs) is often more compelling and easier to implement than a true difference image.

---

## 6. The Killer Feature: "Blink" + Transient Detection

The challenge says: *"Comets, asteroids, stars, brown dwarfs, and even new planets reveal themselves by shifting position between images."*

Your tool should:

1. **Let users select a sky region** (via Aladin Lite)
2. **Show all available epochs** for that region (timeline)
3. **Blink** between epochs (toggle animation)
4. **Highlight moving objects** — either via a simple centroid detection or a "difference mode"
5. **Allow zoom and pan** to inspect objects

### Moving Object Detection (Simple Approach)

For a hackathon, you don't need full source extraction. You can:

1. Get two epochs of the same region
2. Run a simple **connected-components** analysis on the difference image
3. Filter for sources that appear in one epoch but not the other
4. Display these as "candidate moving objects" overlays

Use `scipy.ndimage.label` to identify connected regions above a threshold in the difference image, then filter by size and shape to find point-like candidates.

---

## 7. Hackathon Execution Plan

### Pre-Hackathon (Do This Now)

| Task | Time | Output |
|---|---|---|
| Set up project repo | 1 hour | GitHub repo with frontend/backend skeleton |
| Query IRSA SIA v2 for sample images | 2 hours | List of available SPHEREx images, understand response format |
| Download 20–30 sample FITS files | 2 hours | Local cache of images |
| Convert FITS → PNG with astropy | 2 hours | Visual assets for frontend testing |
| Build mock API (FastAPI) | 3 hours | Working `/images` and `/epochs` endpoints |
| Build basic Aladin Lite viewer | 3 hours | Sky viewer showing image overlays |
| Test blink comparator | 1 hour | Two epochs toggle smoothly |

### Hackathon Weekend (48 Hours)

| Hours | Focus |
|---|---|
| 0–6 | Integrate real IRSA API (replace mock data source) |
| 6–12 | Build timeline slider + epoch selection UI |
| 12–18 | Implement difference/blink mode |
| 18–24 | Moving object candidate detection |
| 24–36 | Polish UI, add "share this view" URL, mobile responsiveness |
| 36–44 | Test with real data, fix bugs |
| 44–48 | Demo prep, video recording, presentation |

---

## 8. Critical Warnings

1. **SPHEREx data is FITS, not JPEG.** Every image requires processing before it can be displayed in a browser. Budget time for this.
2. **The IRSA SIA v2 API returns metadata and URLs, not images directly.** You query for images, get URLs, then download the FITS files.
3. **102 bands means data volume is huge.** For the hackathon, pick **1–3 specific bands** (e.g., near 2.0 μm for stars, 3.3 μm for ices) and build your tool around those. Don't try to handle all 102.
4. **Full-sky visualization is hard.** Aladin Lite can handle large surveys via HiPS, but SPHEREx HiPS maps may not exist yet. You may need to work at the **tile level** — query small regions (e.g., 1° × 1°) rather than rendering the entire sky at once.
5. **The All-Sky Data Cubes might not be ready.** Check IRSA's release schedule on the first day of the hackathon. If they're available, they simplify your life (pre-processed, uniform). If not, Quick Release images are your fallback.

---

## 9. Summary: The Minimum Viable Demo

For a winning hackathon submission, you need:

1. **A working sky viewer** (Aladin Lite) where users can pan/zoom
2. **A timeline slider** showing available epochs for the selected region
3. **A blink mode** that toggles between two epochs with a visible "flicker" effect
4. **A "Find Changes" button** that runs a simple difference detection and highlights candidates
5. **A clean, public-facing UI** that explains what SPHEREx is and why this matters

The mock API ensures this works even if live data is slow or unavailable. The real IRSA integration makes it a legitimate tool. The time-domain focus directly addresses the challenge.

**Start with the mock. Make it work. Then connect to IRSA.**

https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/?tab=details
