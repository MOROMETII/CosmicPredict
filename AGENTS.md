# AGENTS.md — Repository Instructions for COSMIC PREDICT

These instructions apply to all agents and contributors working in this repository.

## 1. Mission and priority order

Build COSMIC PREDICT: a SPHEREx time-domain viewer that lets users inspect the same sky region across observation epochs, blink between observations, compute difference images, and inspect candidate changes.

The product uses conventional, provenance-preserving difference imaging and optional synthetic visual transitions.

When priorities conflict, use this order:

1. Scientific correctness and provenance.
2. A reliable working MVP.
3. Clear, reproducible API and data contracts.
4. Clear explanations of candidate limitations and evidence.
5. Visual polish and interpolation effects.

Do not sacrifice the first four priorities for a flashy demo.

## 2. Required context

Before starting a task:
- Read `CLAUDE.md`.
- Read `aioverview.md` if present.
- Inspect the relevant source files, tests, and project configuration.
- Follow existing conventions unless they conflict with the scientific-integrity rules below.

The product specification establishes:
- Frontend: React/Next.js with Aladin Lite preferred for astronomy visualization.
- Backend: FastAPI (Python preferred).
- Data: IRSA SIA v2 and a local mock/cached provider.
- Processing: FITS via Astropy, NumPy, SciPy, and browser-ready image conversion.
- Core UX: sky viewer, epoch timeline, blink comparator, difference panel, candidate overlays.
- MVP: working sky viewer, timeline, blink, Find Changes, and public-facing explanation.
- Data constraints: FITS is not JPEG; use selected bands/channels and small sky regions; do not assume all-sky cubes or full-sky HiPS availability.

The agreed plan adds:
- Conventional difference detection as the scientific baseline.
- Conventional difference imaging and connected-component candidate extraction.
- A combined ranking that preserves component scores.
- Optional crossfade/optical-flow/diffusion interpolation, always labelled synthetic.

## 3. Non-negotiable scientific integrity

- Real SPHEREx observations are the source of scientific evidence.
- Never fabricate observation dates, coordinates, bands, measurements, archive results, or detections.
- A flagged region is a **candidate**, not a confirmed discovery or object classification.
- Do not call a residual a moving object without multi-epoch position evidence and suitable validation.
- Validate that two observations cover the same sky region and are compatible in band/channel before comparing them.
- Use WCS-aware alignment; equal array dimensions do not imply equal sky coordinates.
- Handle invalid pixels and quality masks. Account for PSF and uncertainty where scientifically appropriate.
- A simple normalized subtraction is acceptable only as a prototype and must be described as simplified.
- Do not claim model accuracy or superiority without measured evaluation.
- Keep archive provenance and processing metadata attached to derived products.
- Synthetic, interpolated, or diffusion-generated frames are visual aids only. Label them clearly and never use them as observations or detection inputs.

## 4. Repository and architecture rules

Maintain clear separation between:

### Frontend
- Next.js, React, TypeScript.
- Sky viewer, epoch controls, blink mode, comparison display, anomaly overlays, candidate details.
- Consume backend APIs; do not parse FITS or perform scientific processing in browser components.

### Backend
- FastAPI route handlers should validate and delegate.
- Keep archive queries, FITS parsing, alignment, difference imaging, source detection, and AI inference in separate modules/services.
- Avoid business logic inside route handlers.

### Data providers
- Implement a provider abstraction so live IRSA and local cached/mock data expose the same application-facing contract.
- Mock/cached data is mandatory for reliable demos and offline development.
- Clearly identify mock fixtures and injected anomalies.

### Storage
- Prefer filesystem cache plus SQLite/JSON metadata for the hackathon.
- Add Redis or other infrastructure only when justified by a demonstrated requirement.
- Never accept arbitrary user-supplied filesystem paths.

## 5. Data and IRSA rules

- Use IRSA SIA v2 as the primary archive query interface specified by the project brief.
- Treat the SIA query response as metadata/links; download FITS files through the returned data URLs or supported archive mechanism.
- Keep IRSA-specific code inside a dedicated client/provider module.
- Use Astroquery where suitable, but verify the actual service parameters and response format rather than assuming examples are complete.
- Check actual archive availability at implementation time. Do not hard-code claims about release dates or assume a particular data product is available.
- Prefer a small verified sample dataset over broad, unverified downloads.
- Start with 1–3 selected bands/channels.
- Work with small sky tiles/regions; do not attempt full-sky processing in the MVP.
- Do not assume SPHEREx HiPS products are available without checking.

Every observation record should preserve available provenance, including:
- archive identifier or source URL,
- observation/epoch timestamp,
- band/channel,
- sky footprint/coordinates,
- data product or processing level,
- retrieval time where useful.

## 6. Image processing and candidate detection

For a pair of observations, the pipeline should perform as many of the following as the data supports:

1. Load FITS data and identify relevant science, uncertainty, and quality extensions.
2. Validate metadata, coverage, band/channel, and usable data.
3. Align/reproject observations using WCS.
4. Normalize photometry when appropriate.
5. Apply quality masks.
6. PSF-match where necessary and feasible.
7. Account for uncertainty/noise in the difference.
8. Generate difference and significance maps.
9. Threshold candidate pixels using a documented criterion.
10. Label connected regions, e.g. using `scipy.ndimage.label`.
11. Filter by area/shape and retain candidate properties.

Keep the basic blink comparator available even if subtraction fails or is not scientifically appropriate.

Candidate records should include, when available:
- stable ID,
- sky coordinates and/or pixel coordinates,
- epoch identifiers and timestamps,
- band/channel,
- difference score/significance,
- candidate size/shape/measurements,
- quality flags,
- provenance,
- classification `unclassified_candidate` unless independently validated.

Do not fabricate missing fields. Use `null`, omit optional values, or return an explicit unavailable status.

## 7. Interpolation and generative models

Implementation priority:
1. Blink between real observations.
2. Crossfade aligned real observations.
3. Optical-flow interpolation.
4. Diffusion-based interpolation as a stretch goal.

Any interpolated/generated frame must:
- carry a visible `Interpolated / synthetic — not an observation` label,
- retain links to the two real endpoint observations,
- be excluded from difference detection, model training, scientific measurements, and candidate evidence,
- never imply that the generated intermediate state was observed by SPHEREx.

Do not add a diffusion model before the real-data viewer and baseline detection work.

## 9. API contract expectations

The backend should provide stable, documented endpoints for:

- image lookup by sky position/region, epoch, and band;
- available epochs for a selected position/region;
- difference imaging between two compatible observations;
- candidate/source history where available;
- optional combined analysis;
- health and active provider status.

Suggested routes:
- `GET /api/images`
- `GET /api/epochs`
- `POST /api/diff`
- `GET /api/objects/{id}/history`
- `POST /api/analyze`
- `GET /api/health`

Live and mock providers must return compatible response shapes. Document schema changes and update frontend clients/tests together.

## 10. Frontend UX expectations

The primary user journey must remain simple:

1. Select a sky region.
2. Choose available observation epochs and band.
3. View/blink between observations.
4. Run Find Changes.
5. Inspect highlighted candidates.
6. Open candidate details and understand why it was flagged.

Always show:
- selected epoch(s),
- selected band/channel,
- live vs cached/mock data status,
- real vs derived vs interpolated image status,
- candidate scores and caveats,
- useful loading, empty, and error states.

Avoid presenting candidate scores as certainty. Use accessible labels and responsive layouts.

## 11. Engineering workflow

For every task:

1. Inspect existing implementation before editing.
2. Identify the smallest useful change.
3. Preserve existing patterns and dependencies where reasonable.
4. Define or confirm API/data contracts before cross-layer changes.
5. Implement a working baseline before optional sophistication.
6. Add or update tests.
7. Run relevant tests, lint, type checks, and formatting commands available in the repository.
8. Summarize changed files, behavior, validation performed, and known limitations.

Do not:
- rewrite the whole application without a clear reason,
- add dependencies casually,
- introduce distributed infrastructure prematurely,
- silently change API response shapes,
- swallow exceptions that indicate missing or invalid scientific data,
- remove provenance or quality information to simplify UI,
- claim a feature works without running or testing it.

## 12. Hackathon delivery priorities

### P0 — Required MVP
- Working sky viewer (Aladin Lite preferred).
- Region selection.
- Available-epoch timeline.
- Blink comparator.
- Image retrieval from mock/cache and a path to live IRSA.
- Find Changes action.
- Difference image and candidate overlays.
- Public-facing explanation of SPHEREx and the app.
- Offline-capable demo.

### P1 — Scientific investigation
- WCS-aware alignment and uncertainty-aware difference imaging.
- Candidate explanation panel with provenance and quality flags.
- Verified target-region catalog and additional cached observations.

### P2 — Polish/stretch
- Smooth crossfade or optical-flow transition.
- Diffusion interpolation experiment.
- Shareable view URL.
- Mobile responsiveness refinements.
- Exportable discovery report.

If time becomes constrained, drop P2 first, then reduce P1 to a small, honest prototype. Never drop data provenance or the working P0 demo.

## 13. Suggested 48-hour execution sequence

- Hours 0–4: verify dataset, scaffold app, define API contracts, confirm two epochs.
- Hours 4–10: viewer, image/epoch endpoints, timeline, blink.
- Hours 10–16: alignment, difference imaging, candidate extraction.
- Hours 16–24: quality-aware difference imaging and candidate extraction.
- Hours 24–30: candidate details, anomaly visualization, optional transition.
- Hours 30–38: end-to-end integration, offline testing, edge cases.
- Hours 38–44: demo narrative, slides, backup recording.
- Hours 44–48: bug fixes, final rehearsal, submission.

Pre-hackathon work should include repository setup, IRSA query tests, downloading a small sample, FITS conversion, mock API, basic viewer, and blink test.

## 14. Testing requirements

At minimum, test:
- valid and invalid RA/Dec;
- no matching observations;
- only one available epoch;
- mismatched band/channel;
- incompatible sky footprints;
- missing/invalid FITS extensions;
- NaNs and quality-masked pixels;
- image alignment and difference generation;
- deterministic injected-source fixture;
- candidate coordinate conversion;
- mock/live provider response compatibility;
- AI unavailable/no-checkpoint behavior;
- interpolation exclusion from scientific analysis;
- offline demo path.

Use deterministic fixtures. Keep test data clearly labelled as synthetic when anomalies are injected.

## 15. Definition of done

A core feature is done only when:
- its behavior is implemented,
- its data provenance is preserved,
- loading/empty/error cases are handled,
- relevant tests pass,
- documentation/API contracts are updated,
- it does not misrepresent synthetic or uncertain output as scientific fact.

The MVP is done when a user can select a supported region, see available epochs, view and blink between observations, run difference detection, inspect candidate overlays, and complete the demo using cached data without depending on live IRSA access.

The extended milestone is done when difference imaging is aligned, quality-aware, reproducible, and supported by additional verified observations.
