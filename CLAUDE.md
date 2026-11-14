# CLAUDE.md — COSMIC PREDICT

## Project mission

Build **COSMIC PREDICT**, a reliable, public-facing SPHEREx time-domain viewer for the NASA Space Apps Challenge. The application helps users explore the same region of the infrared sky across available observation epochs, compare observations, identify candidate changes, and inspect those candidates.

The product's defining direction is a **hybrid scientific + AI workflow**:

1. Real SPHEREx observations and reproducible astronomical image processing are the source of truth.
2. Conventional difference imaging and source detection provide the baseline candidate detections.
3. A JEPA-inspired predictive representation model is an experimental second signal that may help rank unusual regions.
4. Optional image interpolation makes transitions easier to follow, but interpolated/generated frames are never scientific observations.

**Product promise:** help users investigate what changed, what appears unexpected, and what deserves closer inspection. Do not claim that the application autonomously discovers or confirms new astronomical objects.

## Read this first

Before making changes, inspect:
- `README.md` for setup and current project status.
- `AGENTS.md` for repository-wide engineering rules and workflow.
- Existing code and tests before proposing a new architecture.

Treat the project specification in `aioverview.md` as the product baseline. Preserve its core scope:
- Sky viewer using Aladin Lite (preferred) or another explicitly agreed viewer.
- Observation-epoch timeline.
- Blink comparator.
- Difference image and candidate overlay.
- IRSA SIA v2 as the primary archive query interface.
- A mock/cached API that mirrors the real data interface.
- FITS processing before browser display.
- A small number of selected spectral bands and tile-sized sky regions rather than attempting full-sky, all-band processing.

The agreed product plan extends that baseline with a JEPA-inspired anomaly signal, candidate explanation, and optional synthetic visual transitions. Keep these additions modular and optional.

## Product requirements

### Core user journey

1. User opens the sky explorer.
2. User selects a sky position or supported demo region.
3. The app lists observations available for that position/region.
4. User chooses epochs and a supported spectral band.
5. User views either observation and can blink between them.
6. User runs **Find Changes**.
7. The app displays a difference image and candidate-source overlays.
8. User selects a candidate to inspect coordinates, epoch information, measurements/scores, quality caveats, and observation history where available.
9. If enabled, the AI panel displays the JEPA-inspired score separately from the conventional detection score.
10. If enabled, the transition view displays a clearly labelled interpolation between actual observations.

### MVP requirements — implement these before advanced AI

- Interactive sky viewer with pan/zoom and coordinate selection.
- Observation/epoch listing for a selected region.
- Epoch selection and blink comparison.
- Image retrieval through a stable backend interface.
- Difference-image generation for a valid pair of observations.
- Candidate extraction from thresholded difference regions.
- Candidate overlays connected to image coordinates/WCS.
- Clear public-facing explanation of SPHEREx and the purpose of time-domain comparison.
- Local cached/mock dataset so the demo works without live archive access.

### Advanced requirements

- JEPA-inspired latent feature encoder/predictor and spatial anomaly map.
- Combined candidate ranking that preserves the individual component scores.
- Discovery detail panel explaining why a candidate was flagged.
- Optional optical-flow or diffusion-based interpolation.
- Shareable view URL and responsive layout, if time permits.

## Scientific and data integrity rules

These rules are mandatory.

1. **Real observations are the scientific source of truth.** Never replace real observations with generated images while implying they are telescope data.
2. **Do not invent epochs, bands, coordinates, measurements, detections, or archive availability.**
3. A candidate is not a confirmed transient, moving object, planet, or discovery. Use terms such as `candidate`, `possible change`, or `unclassified candidate`.
4. Only compare observations after validating that they cover the same sky region and are compatible in spectral band/channel and relevant data characteristics.
5. Preserve original FITS files and metadata. Derived images must be traceable to source files and processing parameters.
6. Use WCS-aware alignment. Do not assume two arrays are pixel-aligned merely because their dimensions match.
7. For scientifically meaningful subtraction, account for image registration, photometric normalization, PSF matching, invalid pixels/quality masks, and uncertainty/noise. A simplified subtraction may be used for a clearly labelled prototype, not represented as validated scientific photometry.
8. Treat SPHEREx data cadence as limited. Do not imply continuous monitoring or high-cadence transient coverage.
9. Never infer physical motion from a simple residual alone. Motion candidates require position measurements across epochs and appropriate checks.
10. Interpolated or generated frames are **visual aids only**. Label them `Interpolated / synthetic — not an observation` and keep them out of detection, measurement, and evidence pipelines.
11. Keep uncertainty and quality limitations visible in candidate details.
12. Do not claim JEPA improves detection unless an evaluation against a baseline supports that claim.

## Data strategy

### Primary source

Use the official IRSA SPHEREx archive and its SIA v2 interface as specified by the project brief. The query workflow should:
- Search by sky position/region, wavelength/band, and time/observation constraints supported by the archive.
- Parse returned metadata and data URLs.
- Download FITS data separately from the metadata query.
- Store provenance: source URL or archive identifier, observation time, band/channel, sky footprint, processing level, and retrieval time where available.

Use `astroquery.ipac.irsa` where it fits the available service interface. Keep archive access isolated in a data-provider module so the app can switch between live IRSA and cached data without changing frontend contracts.

### Cached/mock provider

A local provider is required for reliable development and demos:
- Pre-download a small, verified sample of FITS files.
- Prefer a small number of interesting regions (for example Orion, Galactic Center, or ecliptic poles), but only use a region after confirming actual archive coverage.
- Convert FITS to browser-friendly PNG/tiles using Astropy and an appropriate stretch.
- Store metadata in SQLite or JSON.
- Mirror the same API response shape as the live provider.
- Clearly mark mock fixtures, synthetic test data, and injected test anomalies.

Do not assume the all-sky data cubes or any particular release product are available. Check current IRSA availability at runtime/build time and retain Quick Release/cached FITS as fallback.

### Data volume and sky coverage

- Start with 1–3 selected spectral bands/channels; do not attempt all 102 channels in the MVP.
- Use small sky tiles/regions (approximately 1° × 1° is a suggested starting scale, not a hard-coded universal limit).
- Do not assume SPHEREx HiPS products exist. Verify before depending on them.
- FITS is not a browser image format. Process or tile it on the backend.

## Architecture and boundaries

Use a three-layer architecture:

### Frontend
- Next.js + React + TypeScript.
- Aladin Lite is the preferred astronomy viewer.
- Components for sky viewer, epoch timeline, blink comparison, difference display, candidate overlay, and discovery details.
- Frontend consumes backend API contracts; it must not implement FITS parsing or scientific image processing.

### Backend
- Python + FastAPI.
- API routes validate inputs and delegate to services.
- Keep HTTP route handlers thin.
- Separate archive access, FITS processing, image comparison, source detection, and AI inference into modules.

### Data and storage
- IRSA SIA v2 live provider.
- Cached/local provider implementing the same interface.
- Filesystem for FITS and derived image assets.
- SQLite or JSON metadata for the hackathon.
- Redis is optional; do not add it unless there is a demonstrated need.

### Suggested module responsibilities

- `irsa_client`: archive query and download.
- `fits_loader`: safely read FITS science/uncertainty/quality data.
- `alignment`: WCS-aware registration.
- `calibration`: normalization and compatible image preparation.
- `difference`: difference image and uncertainty handling.
- `source_detection`: connected components and candidate properties.
- `encoder`: feature extraction.
- `predictor`: latent prediction.
- `anomaly_score`: spatial and candidate-level AI scores.
- `inference`: orchestrate AI model execution.
- `discovery_service`: combine outputs and prepare user-facing details.

Do not let frontend components call IRSA directly.

## API contracts

Keep API contracts stable between live and mock providers. The initial API surface should support the following operations (route spelling can follow the existing repository convention, but document any changes):

- `GET /api/images?ra=...&dec=...&epoch=...&band=...`
  - Return image URL/reference and observation metadata.
- `GET /api/epochs?ra=...&dec=...`
  - Return only verified available epochs for the selected position/region.
- `POST /api/diff`
  - Accept region, two epoch identifiers, and band; return difference asset and candidate list.
- `GET /api/objects/{id}/history`
  - Return available observations/measurements for a candidate/source when such a history exists.
- `POST /api/analyze`
  - Optionally run conventional and JEPA-inspired analysis.
- `GET /api/health`
  - Return service health and active data-provider mode.

A candidate response should keep its evidence explicit. Suggested fields:
- stable candidate ID
- RA/Dec or pixel coordinates with WCS-derived sky coordinates
- epoch A and epoch B identifiers/timestamps
- band/channel
- difference significance/score
- JEPA anomaly score, nullable when disabled/unavailable
- candidate morphology/area and measurements when computed
- quality flags and caveats
- source provenance
- classification defaulting to `unclassified_candidate`

Never return fabricated scores or coordinates. Mock fixtures must be explicitly marked as mock.

## Image processing requirements

For each pair:
1. Load the relevant FITS HDUs and identify science, uncertainty, and quality information.
2. Validate observation metadata, coverage, band/channel, and usable pixels.
3. Reproject/align using WCS.
4. Normalize photometry only where scientifically justified.
5. Apply quality masks.
6. PSF-match where required and feasible.
7. Propagate or otherwise account for uncertainty in the difference.
8. Produce a difference image and significance map.
9. Threshold using a documented noise/significance criterion.
10. Label connected components (for example with `scipy.ndimage.label`).
11. Filter candidates by area/shape and retain enough metadata for review.

The simple NumPy subtraction approach in the project brief is acceptable as an early prototype only when clearly identified as simplified. Keep the implementation replaceable by a more rigorous method or a standard tool such as HOTPANTS if available.

## JEPA-inspired AI requirements

The AI system is an additional analysis signal, not the authority for scientific claims.

Initial implementation direction:
- Use PyTorch.
- Start with a frozen pretrained visual encoder only if its license, input requirements, and suitability are checked.
- Because natural-image/video pretrained models may not represent astronomical infrared imagery well, support a small domain-specific encoder or feature baseline.
- Train a lightweight predictor to predict target latent features from earlier observation features.
- Use held-out observations/regions for evaluation; avoid leakage between train and evaluation samples.
- Produce a spatial latent prediction-error map and/or candidate-level score.
- Keep model inference optional and bounded so the app remains usable without a GPU/model checkpoint.
- Return `null`/`unavailable` rather than fabricated AI scores if the model is not loaded.

Use accurate language: call the feature **JEPA-inspired** unless the implementation genuinely follows a JEPA architecture/training setup. Do not claim that simply running V-JEPA features constitutes training a SPHEREx JEPA model.

Candidate ranking may combine normalized conventional and AI signals, but:
- Keep component scores visible.
- Document weights and calibration.
- Do not label a combined score as a probability unless calibrated as one.
- Compare against the difference-only baseline before claiming improvement.

## Visual interpolation requirements

Priority order:
1. Blink/toggle between real observations.
2. Crossfade between aligned real observations.
3. Optical-flow interpolation if time allows.
4. Diffusion-based interpolation only as an experimental enhancement.

Generated/interpolated frames must:
- Be clearly labelled as synthetic/interpolated.
- Never be fed into scientific detection as if they were observations.
- Never be used to claim an object existed at an unobserved intermediate time.
- Preserve access to the original endpoint observations.

## UI and terminology

Use clear, restrained scientific language:
- `Observation` for real archive data.
- `Epoch` for observation time/visit.
- `Difference image` for subtraction output.
- `Candidate` or `candidate anomaly` for unconfirmed detections.
- `JEPA-inspired score` for the latent prediction signal.
- `Interpolated preview` for generated transitions.

The UI should make it obvious:
- Which observation/epoch and band are selected.
- Whether data is live archive data or cached demo data.
- Whether an image is real, derived, or interpolated.
- Why a candidate was flagged.
- What quality limitations apply.

## Development workflow

1. Inspect the repository and current state before editing.
2. Keep changes small and coherent.
3. Implement the mock/cached provider and API contract early.
4. Build the frontend against the stable API contract.
5. Integrate live IRSA access behind the provider abstraction.
6. Implement blink comparison before advanced subtraction.
7. Implement a conventional difference-detection baseline before JEPA.
8. Add JEPA as optional analysis after the baseline works.
9. Add interpolation last.
10. Keep the application demoable offline using cached data.

Do not rewrite the stack or add infrastructure without a concrete need. Prefer filesystem caching and SQLite over Redis or distributed services for the hackathon MVP.

## Testing and quality gates

Before considering a feature complete:
- Add unit tests for parsing, coordinate/metadata validation, image processing, and candidate extraction.
- Add API tests for live/mock provider contract consistency.
- Add frontend tests for epoch selection, blink mode, and candidate selection where test infrastructure exists.
- Test missing epochs, missing FITS extensions, invalid pixels, mismatched bands, incompatible coverage, and archive timeouts.
- Include a deterministic fixture with a known injected change to test the detection pipeline.
- Confirm that no generated transition is included in scientific analysis.
- Verify that the offline demo works.

Never weaken tests or silently swallow scientific/data errors to make a demo pass.

## Performance and reliability

- Cache archive query results, FITS downloads, and derived image products.
- Avoid repeated FITS downloads for the same observation.
- Process small regions and selected bands.
- Use background tasks for slow downloads/processing if needed.
- Return actionable errors when an epoch or region has no matching data.
- Keep the cached demo path available if IRSA is unavailable.
- Do not make the demo depend on a live external API at presentation time.

## Security and configuration

- Never commit credentials, tokens, or personal access keys.
- Keep environment configuration in `.env`; commit only `.env.example`.
- Validate RA/Dec, band, epoch IDs, and file references.
- Do not accept arbitrary filesystem paths from API clients.
- Restrict file serving to approved data/processed directories.
- Avoid logging secrets or excessive raw data.

## Documentation expectations

Update README and relevant docs when changing:
- setup commands
- environment variables
- API routes/schemas
- data acquisition
- processing assumptions
- model checkpoints/training
- demo instructions

Document which parts are real archive data, cached archive data, synthetic fixtures, derived products, or interpolated previews.

## Definition of done

The MVP is ready when a user can:
- open the sky viewer,
- select a supported region,
- see available epochs,
- view and blink between real/cached SPHEREx observations,
- run a difference operation,
- inspect candidate overlays,
- understand the provenance and limitations,
- complete the demo without relying on live IRSA access.

The hybrid AI milestone is ready when the JEPA-inspired analysis can run optionally, return reproducible scores/maps, and be evaluated against the conventional baseline without changing the core user journey.
