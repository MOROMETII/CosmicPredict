"""FastAPI routes backed by the local cached observation catalog."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from io import BytesIO
from datetime import datetime
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from PIL import Image
from scipy import ndimage

from backend import storage
from backend.api.schemas import (
    AnalyzeRegionRequest,
    AnalyzeRequest,
    AnalyzeResponse,
    EpochsResponse,
    FeedItem,
    FeedResponse,
    GaiaMatchResponse,
    GaiaOverlayResponse,
    GaiaSourceResponse,
    LikeCreateRequest,
    LikeResponse,
    LikesResponse,
    SkyMapItem,
    SkyMapResponse,
    SurveyItem,
    SurveyResponse,
    MarkCreateRequest,
    MarkResponse,
    MarksResponse,
    ObservationResponse,
    SpectrumPoint,
    SpectrumResponse,
    TimelineFrame,
    TimelineResponse,
)
from backend.astronomy import cutout as cutout_module
from backend.astronomy import render
from backend import config, storage
from backend.api.schemas import AnalyzeRequest, AnalyzeResponse, EpochsResponse, ObservationResponse
from backend.astronomy import compact, opencv_detection, render
from backend.astronomy.difference import significance_map
from backend.astronomy.fits_loader import load_fits_observation

router = APIRouter(prefix="/api")


def _parse_epoch(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


_CATALOG_TTL_SECONDS = 30.0
_catalog_cache: dict[str, Any] = {"expires_at": 0.0, "records": {}}


def _catalog() -> dict[str, ObservationResponse]:
    now = time.monotonic()
    if now < _catalog_cache["expires_at"]:
        return _catalog_cache["records"]
    records: dict[str, ObservationResponse] = {}
    for record in storage.list_observations():
        observation_id = record["observation_id"]
        header = record.get("header") or {}
        records[observation_id] = ObservationResponse(
            observation_id=observation_id,
            epoch=_parse_epoch(record.get("epoch")),
            band=record.get("band"),
            wavelength=float(header["WAVELENGTH"]) if header.get("WAVELENGTH") is not None else None,
            ra=float(record["ra"]) if record.get("ra") is not None else None,
            dec=float(record["dec"]) if record.get("dec") is not None else None,
            source=record.get("source") or "cached",
            provenance={
                "source_path": record.get("local_path"),
                "storage_path": record.get("storage_path"),
                "header": header,
            },
            image_url=f"/api/images/{observation_id}/preview",
            asset_status=record.get("asset_status") or "preview_available",
        )
    _catalog_cache["records"] = records
    _catalog_cache["expires_at"] = now + _CATALOG_TTL_SECONDS
    return records


def _load_raw_patch(observation_id: str, row: int, column: int, size: int) -> tuple[np.ndarray, np.ndarray | None, np.ndarray]:
    if observation_id not in _catalog():
        raise HTTPException(status_code=404, detail=f"unknown observation: {observation_id}")
    observation = storage.load_observation(observation_id)
    end_row, end_column = row + size, column + size
    if end_row > observation.image.shape[0] or end_column > observation.image.shape[1]:
        raise HTTPException(status_code=422, detail="requested patch exceeds image bounds")
    image = observation.image[row:end_row, column:end_column]
    variance = None if observation.variance is None else observation.variance[row:end_row, column:end_column]
    valid = observation.valid_mask[row:end_row, column:end_column]
    return image, variance, valid


def _png_response(image: Image.Image) -> Response:
    payload = BytesIO()
    # `optimize=True` re-compresses PNGs at ~5x the cost for a ~3% size saving;
    # the default zlib level is far faster and effectively identical for these
    # smooth astronomical images.
    image.save(payload, format="PNG", compress_level=1)
    return Response(content=payload.getvalue(), media_type="image/png")


def _angular_separation(ra_a: float, dec_a: float, ra_b: float, dec_b: float) -> float:
    ra_a_rad, dec_a_rad = np.deg2rad([ra_a, dec_a])
    ra_b_rad, dec_b_rad = np.deg2rad([ra_b, dec_b])
    cosine = (
        np.sin(dec_a_rad) * np.sin(dec_b_rad)
        + np.cos(dec_a_rad) * np.cos(dec_b_rad) * np.cos(ra_a_rad - ra_b_rad)
    )
    return float(np.rad2deg(np.arccos(np.clip(cosine, -1.0, 1.0))))


def _validate_pair(context_epoch: str, target_epoch: str) -> tuple[ObservationResponse, ObservationResponse]:
    records = _catalog()
    context = records.get(context_epoch)
    target = records.get(target_epoch)
    if context is None or target is None:
        raise HTTPException(status_code=404, detail="both observations must exist in the cached catalog")
    if context.band and target.band and context.band != target.band:
        raise HTTPException(
            status_code=422,
            detail=f"observations use incompatible spectral channels (detector {context.band} vs {target.band})",
        )
    if context.wavelength is not None and target.wavelength is not None and abs(context.wavelength - target.wavelength) > 0.05:
        raise HTTPException(
            status_code=422,
            detail=f"observations use incompatible wavelengths ({context.wavelength:.3f} vs {target.wavelength:.3f} um)",
        )
    if None not in (context.ra, context.dec, target.ra, target.dec):
        separation = _angular_separation(context.ra, context.dec, target.ra, target.dec)
        if separation > 0.1:
            raise HTTPException(
                status_code=422,
                detail=f"observations do not cover the same cached region ({separation:.3f} degrees apart)",
            )
    return context, target


def _candidates_from_map(
    score_map: np.ndarray,
    *,
    source: str,
    coordinate_space: str,
    minimum_area: int = 2,
    maximum_candidates: int = 50,
    minimum_score: float | None = None,
) -> list[dict[str, Any]]:
    finite = np.isfinite(score_map)
    values = score_map[finite]
    if values.size == 0:
        return []
    threshold = max(float(np.percentile(values, 99.0)), float(values.mean() + 3.0 * values.std()))
    if minimum_score is not None:
        threshold = max(threshold, minimum_score)
    labeled, count = ndimage.label(finite & (score_map >= threshold))
    candidates: list[dict[str, Any]] = []
    for label_index in range(1, count + 1):
        rows, columns = np.where(labeled == label_index)
        area = int(rows.size)
        if area < minimum_area:
            continue
        top, bottom = int(rows.min()), int(rows.max()) + 1
        left, right = int(columns.min()), int(columns.max()) + 1
        candidates.append(
            {
                "candidate_id": f"{source}-{len(candidates):03d}",
                "source": source,
                "row": top,
                "column": left,
                "height": bottom - top,
                "width": right - left,
                "area": area,
                "score": float(score_map[rows, columns].max()),
                "coordinate_space": coordinate_space,
            }
        )
    return sorted(candidates, key=lambda candidate: candidate["score"], reverse=True)[
        :maximum_candidates
    ]


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "provider": "supabase" if storage.is_supabase_available() else "cached",
        "observation_count": len(_catalog()),
    }


@router.get("/epochs", response_model=EpochsResponse)
def epochs(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    radius: float = Query(default=1.0, ge=0.05, le=5.0),
) -> EpochsResponse:
    observations = [
        observation
        for observation in _catalog().values()
        if observation.ra is not None
        and observation.dec is not None
        and _angular_separation(ra, dec, observation.ra, observation.dec) <= radius
    ]
    return EpochsResponse(
        status="cached_region_match" if observations else "no_cached_region_match",
        observations=observations,
        message=(
            f"Cached observations are selected by center separation within {radius} degrees. "
            "Full WCS footprint validation is not available for this fixture."
            if observations
            else f"No cached observation centers are within {radius} degrees of RA={ra}, Dec={dec}."
        ),
    )


@router.get("/images/{observation_id}", response_model=ObservationResponse)
def image(observation_id: str) -> ObservationResponse:
    record = _catalog().get(observation_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"unknown observation: {observation_id}")
    return record


@router.get("/images/{observation_id}/preview")
def image_preview(observation_id: str) -> Response:
    record = _catalog().get(observation_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"unknown observation: {observation_id}")
    try:
        observation = storage.load_observation(observation_id)
        wavelength = record.wavelength
        png = Image.fromarray(render.render_mono(observation.image, observation.valid_mask, wavelength), mode="RGB")
    except (OSError, ValueError, TypeError) as error:
        raise HTTPException(status_code=500, detail=f"could not render observation preview: {error}") from error
    return _png_response(png)


@router.get("/diff/preview")
def difference_preview(
    context_epoch: str,
    target_epoch: str,
    row: int = Query(default=0, ge=0),
    column: int = Query(default=0, ge=0),
    size: int = Query(default=128, ge=8, le=1024, multiple_of=8),
) -> Response:
    _validate_pair(context_epoch, target_epoch)
    image_a, var_a, valid_a = _load_raw_patch(context_epoch, row, column, size)
    image_b, var_b, valid_b = _load_raw_patch(target_epoch, row, column, size)
    significance, valid = significance_map(image_a, var_a, valid_a, image_b, var_b, valid_b)
    png = Image.fromarray(render.render_difference(significance, valid), mode="RGB")
    return _png_response(png)


@router.get("/images", response_model=list[ObservationResponse])
def images() -> list[ObservationResponse]:
    return list(_catalog().values())


@router.get("/skymap", response_model=SkyMapResponse)
def skymap() -> SkyMapResponse:
    """Coordinates + previews for every observation on the homepage, for a sky-map.

    The homepage displays one cached observation per tile; this endpoint returns
    each observation's RA/Dec (in degrees) and its preview URL so the frontend
    can place a pin on an all-sky map. RA maps to longitude (0–360), Dec to
    latitude (−90–90).
    """
    items: list[SkyMapItem] = []
    for observation in _catalog().values():
        if observation.ra is None or observation.dec is None:
            continue
        items.append(
            SkyMapItem(
                observation_id=observation.observation_id,
                ra=observation.ra,
                dec=observation.dec,
                epoch=observation.epoch,
                band=observation.band,
                wavelength=observation.wavelength,
                source=observation.source,
                preview_url=observation.image_url,
            )
        )
    return SkyMapResponse(
        status="ok" if items else "empty",
        observations=items,
        caveats=[
            "Positions are observation pointing centers (RA/Dec in degrees), not precise source locations.",
            "The sky map uses an equirectangular projection: RA = longitude, Dec = latitude.",
        ],
    )


# Rendered aligned-cutout PNGs are small (~100 KB); keep a bounded in-memory
# cache so timeline playback does not re-read a FITS file per frame.
_CUTOUT_CACHE_LIMIT = 256
_cutout_cache: "dict[tuple[str, float, float, float, int], bytes]" = {}


def _aligned_cutout(observation_id: str, ra: float, dec: float, fov: float, size: int):
    record = _catalog().get(observation_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"unknown observation: {observation_id}")
    try:
        observation = storage.load_observation(observation_id)
        aligned = cutout_module.north_up_cutout(observation, ra=ra, dec=dec, fov_arcmin=fov, size=size)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"could not load observation data: {error}") from error
    return record, aligned


def _cutout_png(
    observation_id: str,
    ra: float,
    dec: float,
    fov: float,
    size: int,
    vmin: float | None = None,
    vmax: float | None = None,
) -> bytes:
    key = (observation_id, round(ra, 6), round(dec, 6), round(fov, 3), size, vmin, vmax)
    cached = _cutout_cache.get(key)
    if cached is not None:
        return cached
    record, aligned = _aligned_cutout(observation_id, ra, dec, fov, size)
    try:
        rgb = render.render_mono(aligned.image, aligned.valid_mask, record.wavelength, vmin, vmax)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    payload = BytesIO()
    Image.fromarray(rgb, mode="RGB").save(payload, format="PNG", compress_level=1)
    data = payload.getvalue()
    if len(_cutout_cache) >= _CUTOUT_CACHE_LIMIT:
        _cutout_cache.pop(next(iter(_cutout_cache)))
    _cutout_cache[key] = data
    return data


@router.get("/cutout/{observation_id}")
def cutout_preview(
    observation_id: str,
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    fov: float = Query(default=15.0, ge=0.5, le=240.0, description="field of view in arcminutes"),
    size: int = Query(default=256, ge=8, le=cutout_module.MAX_CUTOUT_SIZE),
    vmin: float | None = Query(default=None, description="fixed lower brightness limit (locks the frame-series scale)"),
    vmax: float | None = Query(default=None, description="fixed upper brightness limit"),
) -> Response:
    """North-up cutout PNG centered on (ra, dec): every epoch's cutout shares the same sky grid."""
    return Response(content=_cutout_png(observation_id, ra, dec, fov, size, vmin, vmax), media_type="image/png")


@router.get("/timeline", response_model=TimelineResponse)
def timeline(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    fov: float = Query(default=15.0, ge=0.5, le=240.0),
    band: str | None = Query(default=None, description="detector band; defaults to the best-covered one"),
) -> TimelineResponse:
    """Chronological, same-band observations whose detector footprint contains (ra, dec)."""
    containing = [
        record
        for record in _catalog().values()
        if cutout_module.contains_position(record.provenance.get("header") or {}, ra, dec)
    ]
    by_band: dict[str, list[ObservationResponse]] = {}
    for record in containing:
        by_band.setdefault(record.band or "unknown", []).append(record)
    available = {name: len(records) for name, records in sorted(by_band.items())}

    chosen = band
    if chosen is None and by_band:
        # Most *distinct epochs* wins: a time series needs spread, not bulk.
        chosen = max(by_band, key=lambda b: (len({r.epoch for r in by_band[b]}), len(by_band[b])))
    frames = sorted(by_band.get(chosen, []), key=lambda r: (r.epoch is None, r.epoch))

    # Lock one brightness scale across the series (computed from the best-covered
    # frame) so true brightness changes, e.g. variable stars, stay visible.
    stretch_suffix = ""
    if frames:
        coverages = {
            record.observation_id: cutout_module.footprint_coverage(
                record.provenance.get("header") or {}, ra, dec, fov
            )
            for record in frames
        }
        reference = max(frames, key=lambda r: coverages.get(r.observation_id) or 0.0)
        try:
            _, aligned = _aligned_cutout(reference.observation_id, ra, dec, fov, 256)
            vmin, vmax = render.compute_limits(aligned.image, aligned.valid_mask)
            stretch_suffix = f"&vmin={vmin:.6g}&vmax={vmax:.6g}"
        except HTTPException:
            pass  # fall back to per-frame stretch rather than fail the listing
    else:
        coverages = {}

    return TimelineResponse(
        status="ok" if frames else "no_matching_observations",
        ra=ra,
        dec=dec,
        fov_arcmin=fov,
        band=chosen,
        available_bands=available,
        frames=[
            TimelineFrame(
                observation_id=record.observation_id,
                epoch=record.epoch,
                band=record.band,
                wavelength=record.wavelength,
                source=record.source,
                coverage=coverages.get(record.observation_id),
                cutout_url=(
                    f"/api/cutout/{record.observation_id}?ra={ra}&dec={dec}&fov={fov}&size=256{stretch_suffix}"
                ),
            )
            for record in frames
        ],
        caveats=[
            "Frames are bilinearly resampled onto a shared north-up grid for alignment (display-grade).",
            "All frames share one brightness scale, so brightness changes between dates are real signal (within calibration limits).",
            "Gray areas are outside an exposure's detector footprint or masked as unreliable pixels.",
            "Consecutive frames can be weeks or months apart; motion between frames is not continuous.",
        ],
        message=None
        if frames
        else (
            "No cached observation footprint contains this position"
            + (f" in band {band}." if band else ". Try another position or scrape more data.")
        ),
    )


def _analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    _validate_pair(request.context_epoch, request.target_epoch)
    image_a, var_a, valid_a = _load_raw_patch(request.context_epoch, request.row, request.column, request.size)
    image_b, var_b, valid_b = _load_raw_patch(request.target_epoch, request.row, request.column, request.size)
    significance, valid = significance_map(image_a, var_a, valid_a, image_b, var_b, valid_b)
    difference_score = float(np.mean(np.abs(significance[valid]))) if valid.any() else 0.0
    difference_image_url = (
        f"/api/diff/preview?context_epoch={request.context_epoch}"
        f"&target_epoch={request.target_epoch}&row={request.row}"
        f"&column={request.column}&size={request.size}"
    )
    return AnalyzeResponse(
        status="ok",
        context_epoch=request.context_epoch,
        target_epoch=request.target_epoch,
        difference_score=difference_score,
        difference_image_url=difference_image_url,
        candidates=_candidates_from_map(
            np.abs(significance),
            source="significance",
            coordinate_space="image_patch_pixel",
            minimum_score=5.0,
        ),
        caveats=[
            "Difference score is the mean absolute noise-normalized significance (sigma).",
            "Candidates are regions exceeding a 5-sigma significance threshold and are not confirmed detections.",
        ],
    )


def _aligned_pair(
    context_id: str, target_id: str, ra: float, dec: float, fov: float, size: int
) -> tuple[cutout_module.AlignedCutout, cutout_module.AlignedCutout]:
    """Validate and produce the aligned cutout pair for a region comparison."""
    records = _catalog()
    context, target = records.get(context_id), records.get(target_id)
    if context is None or target is None:
        raise HTTPException(status_code=404, detail="both observations must exist in the catalog")
    if context.band and target.band and context.band != target.band:
        raise HTTPException(
            status_code=422,
            detail=(
                f"These observations come from different detectors ({context.band} vs {target.band}) "
                "and see different infrared wavelengths, so their brightness cannot be compared. "
                "Pick two observations from the same detector."
            ),
        )
    for label, record in (("first", context), ("second", target)):
        header = record.provenance.get("header") or {}
        if not cutout_module.contains_position(header, ra, dec):
            raise HTTPException(
                status_code=422,
                detail=f"The {label} observation ({record.observation_id}) does not cover this sky position.",
            )
    cutouts = []
    for record in (context, target):
        try:
            observation = storage.load_observation(record.observation_id)
            cutouts.append(
                cutout_module.north_up_cutout(observation, ra=ra, dec=dec, fov_arcmin=fov, size=size)
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except OSError as error:
            raise HTTPException(status_code=500, detail=f"could not load observation data: {error}") from error
    return cutouts[0], cutouts[1]


# Match radius for "does this candidate coincide with a known star": generous
# relative to SPHEREx's ~6 arcsec pixels and the display-grade alignment.
_GAIA_MATCH_RADIUS_ARCSEC = 10.0


def _enrich_candidates_with_gaia(
    candidates: list[dict[str, Any]], ra: float, dec: float, fov: float, size: int
) -> tuple[list[dict[str, Any]], list[str]]:
    """Attach WCS sky coordinates and a Gaia DR3 cross-match to each candidate.

    Degrades honestly: when the Gaia archive is unreachable and uncached, the
    candidates keep ``gaia_checked=False`` and a caveat says the catalog
    check did not run — absence of a match is then meaningless.
    """
    from backend.storage import gaia

    caveats: list[str] = []
    if not candidates:
        return candidates, caveats
    grid = cutout_module.aligned_grid_wcs(ra, dec, fov, size)
    centers = [
        (candidate["column"] + candidate["width"] / 2.0, candidate["row"] + candidate["height"] / 2.0)
        for candidate in candidates
    ]
    sky = grid.wcs_pix2world(centers, 0)
    for candidate, (candidate_ra, candidate_dec) in zip(candidates, sky):
        candidate["ra"] = round(float(candidate_ra) % 360.0, 6)
        candidate["dec"] = round(float(candidate_dec), 6)

    try:
        # Cover the whole frame (half-diagonal) so every candidate is inside.
        sources, _ = gaia.cone_search(ra, dec, radius_arcmin=fov * 0.75)
    except gaia.GaiaUnavailableError:
        caveats.append(
            "Gaia DR3 cross-match unavailable (archive unreachable, no cache) — "
            "candidates are NOT checked against the star catalog this time."
        )
        return candidates, caveats

    for candidate in candidates:
        candidate["gaia_checked"] = True
        best: tuple[float, gaia.GaiaSource] | None = None
        for source in sources:
            separation = _angular_separation(candidate["ra"], candidate["dec"], source.ra, source.dec) * 3600.0
            if separation <= _GAIA_MATCH_RADIUS_ARCSEC and (best is None or separation < best[0]):
                best = (separation, source)
        if best is None:
            candidate["interpretation"] = (
                "No catalogued Gaia DR3 star within "
                f"{_GAIA_MATCH_RADIUS_ARCSEC:.0f}″ — this change is not explained by the optical star "
                "catalog, which makes it worth closer inspection (a faint solar-system body would not be in Gaia)."
            )
            continue
        separation, source = best
        candidate["gaia_match"] = GaiaMatchResponse(
            source_id=source.source_id,
            separation_arcsec=round(separation, 2),
            g_mag=source.g_mag,
            pm_total_mas_yr=None if source.pm_total is None else round(source.pm_total, 2),
            parallax_mas=source.parallax,
            variable_flag=source.variable_flag,
        )
        descriptors = []
        if source.variable_flag == "VARIABLE":
            descriptors.append("catalogued as photometrically variable")
        if source.pm_total is not None and source.pm_total > 100.0:
            descriptors.append(f"high proper motion ({source.pm_total:.0f} mas/yr)")
        detail = f" ({', '.join(descriptors)})" if descriptors else ""
        candidate["interpretation"] = (
            f"Coincides with known star Gaia DR3 {source.source_id}"
            f"{detail} at {separation:.1f}″ — most plausibly that star varying or drifting, not a new object."
        )
    caveats.append(
        "Candidates are cross-matched against the Gaia DR3 star catalog (ESA) within "
        f"{_GAIA_MATCH_RADIUS_ARCSEC:.0f}″; a match suggests a known star, not a new object."
    )
    return candidates, caveats


_ALIGNED_CAVEATS = [
    "Both epochs are resampled onto the same north-up sky grid before subtraction (display-grade alignment).",
    "Candidates are regions exceeding a 5-sigma noise-normalized threshold; they are unclassified and not confirmed detections.",
    "SPHEREx detectors are linear-variable filters: the same sky position can be sampled at a slightly different wavelength on each visit, which can change apparent brightness without true variability.",
]


@router.get("/patch_center")
def patch_center(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    fov: float = Query(..., ge=0.5, le=240.0),
    size: int = Query(default=256, ge=8, le=cutout_module.MAX_CUTOUT_SIZE),
    x0: float = Query(..., ge=0, le=1),
    y0: float = Query(..., ge=0, le=1),
    x1: float = Query(..., ge=0, le=1),
    y1: float = Query(..., ge=0, le=1),
) -> dict[str, float]:
    """Map a fractional image rectangle to the sky center + FOV of that patch.

    Takes a selection on the aligned cutout grid (fractions 0..1 of the image
    width/height) and returns the (ra, dec, fov_arcmin) that re-centers a new
    cutout on exactly that sub-region, so the frontend can "zoom in" on a patch
    without doing any sky math itself.
    """
    if not (0 <= x0 < x1 <= 1) or not (0 <= y0 < y1 <= 1):
        raise HTTPException(status_code=422, detail="selection must satisfy 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1")
    grid = cutout_module.aligned_grid_wcs(ra, dec, fov, size)
    center_sky = grid.wcs_pix2world([[((x0 + x1) / 2) * size, ((y0 + y1) / 2) * size]], 0)[0]
    new_fov = fov * max(x1 - x0, y1 - y0)
    return {"ra": float(center_sky[0] % 360.0), "dec": float(center_sky[1]), "fov_arcmin": float(new_fov)}


@router.get("/diff/aligned")
def aligned_difference_preview(
    context_epoch: str,
    target_epoch: str,
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    fov: float = Query(default=15.0, ge=0.5, le=240.0),
    size: int = Query(default=256, ge=8, le=cutout_module.MAX_CUTOUT_SIZE),
) -> Response:
    """Difference image (red = brighter in A, blue = brighter in B) on the aligned cutout grid."""
    cut_a, cut_b = _aligned_pair(context_epoch, target_epoch, ra, dec, fov, size)
    significance, valid = significance_map(
        cut_a.image, cut_a.variance, cut_a.valid_mask, cut_b.image, cut_b.variance, cut_b.valid_mask
    )
    png = Image.fromarray(render.render_difference(significance, valid), mode="RGB")
    return _png_response(png)


@router.get("/explore/aligned")
def explore_aligned_preview(
    context_epoch: str,
    target_epoch: str,
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    fov: float = Query(default=15.0, ge=0.5, le=240.0),
    size: int = Query(default=256, ge=8, le=cutout_module.MAX_CUTOUT_SIZE),
) -> Response:
    """Difference image with OpenCV-detected candidates boxed (visual aid)."""
    cut_a, cut_b = _aligned_pair(context_epoch, target_epoch, ra, dec, fov, size)
    significance, valid = significance_map(
        cut_a.image, cut_a.variance, cut_a.valid_mask, cut_b.image, cut_b.variance, cut_b.valid_mask
    )
    diff_rgb = render.render_difference(significance, valid)
    candidates, _mask = opencv_detection.detect_changes(diff_rgb)
    annotated = opencv_detection.annotate(diff_rgb, candidates)
    return _png_response(Image.fromarray(annotated, mode="RGB"))


@router.post("/explore_region", response_model=AnalyzeResponse)
def explore_region(request: AnalyzeRegionRequest) -> AnalyzeResponse:
    """OpenCV change detection on the rendered difference image (visual aid).

    Distinct from /analyze_region (the noise-normalized scientific baseline).
    Candidates here are thresholded connected components on a display render,
    not significance detections.
    """
    cut_a, cut_b = _aligned_pair(
        request.context_epoch, request.target_epoch, request.ra, request.dec, request.fov_arcmin, request.size
    )
    significance, valid = significance_map(
        cut_a.image, cut_a.variance, cut_a.valid_mask, cut_b.image, cut_b.variance, cut_b.valid_mask
    )
    diff_rgb = render.render_difference(significance, valid)
    candidates, _mask = opencv_detection.detect_changes(diff_rgb)
    annotated_url = (
        f"/api/explore/aligned?context_epoch={request.context_epoch}&target_epoch={request.target_epoch}"
        f"&ra={request.ra}&dec={request.dec}&fov={request.fov_arcmin}&size={request.size}"
    )
    return AnalyzeResponse(
        status="ok",
        context_epoch=request.context_epoch,
        target_epoch=request.target_epoch,
        difference_score=None,
        difference_image_url=annotated_url,
        candidates=[
            {
                "candidate_id": candidate["candidate_id"],
                "source": "opencv",
                "row": candidate["row"],
                "column": candidate["column"],
                "height": candidate["height"],
                "width": candidate["width"],
                "area": candidate["area"],
                "score": candidate["score"],
                "coordinate_space": candidate["coordinate_space"],
                "classification": "unclassified_candidate",
                "caveat": "OpenCV visual-aid candidate on a rendered difference image; not noise-normalized.",
            }
            for candidate in candidates
        ],
        caveats=[
            "OpenCV candidates are thresholded connected components on a display render, not significance detections.",
            "Candidates are unclassified and require scientific validation.",
            "The rendered difference can saturate; scores are display magnitudes, not sigma.",
        ],
    )


@router.post("/analyze_region", response_model=AnalyzeResponse)
def analyze_region(request: AnalyzeRegionRequest) -> AnalyzeResponse:
    """Noise-aware change detection between two epochs at a sky position.

    Unlike the legacy /analyze, this compares WCS-aligned cutouts centered on
    the requested position, so candidate pixel coordinates land directly on
    the same grid as the /cutout frames the user is viewing.
    """
    cut_a, cut_b = _aligned_pair(
        request.context_epoch, request.target_epoch, request.ra, request.dec, request.fov_arcmin, request.size
    )
    significance, valid = significance_map(
        cut_a.image, cut_a.variance, cut_a.valid_mask, cut_b.image, cut_b.variance, cut_b.valid_mask
    )
    difference_score = float(np.mean(np.abs(significance[valid]))) if valid.any() else 0.0
    difference_image_url = (
        f"/api/diff/aligned?context_epoch={request.context_epoch}&target_epoch={request.target_epoch}"
        f"&ra={request.ra}&dec={request.dec}&fov={request.fov_arcmin}&size={request.size}"
    )
    candidates = _candidates_from_map(
        np.abs(significance),
        source="significance",
        coordinate_space="aligned_cutout_pixel",
        minimum_score=5.0,
    )
    candidates, gaia_caveats = _enrich_candidates_with_gaia(
        candidates, request.ra, request.dec, request.fov_arcmin, request.size
    )
    return AnalyzeResponse(
        status="ok",
        context_epoch=request.context_epoch,
        target_epoch=request.target_epoch,
        difference_score=difference_score,
        difference_image_url=difference_image_url,
        candidates=candidates,
        caveats=_ALIGNED_CAVEATS + gaia_caveats,
    )


@router.post("/fetch_region")
def fetch_region(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
) -> dict[str, Any]:
    """Fetch time-spread SPHEREx cutouts of this position from the live IRSA archive.

    Downloads only small server-side cutouts (a few MB per epoch, not the full
    65 MB products) into the local cache; the catalog picks them up on its next
    refresh. Bounded and polite: at most 8 frames, rate-limited, remembered in
    a ledger so repeat requests cost nothing.

    The download runs on a background thread (a full fetch takes minutes,
    longer than HTTP proxies keep a request open). The response is immediate;
    repeat the same request to poll until ``status`` is ``already_fetched``
    (success) or ``failed``.
    """
    from backend.storage import live_archive

    result = live_archive.start_fetch(ra, dec)
    if result["status"] == "already_fetched":
        # New files invalidate the catalog cache so the next /timeline sees them.
        _catalog_cache["expires_at"] = 0.0
    return result


def _region_preview_url(ra: float, dec: float) -> str | None:
    """A cutout preview URL for a sky position, from any cached observation covering it."""
    for record in _catalog().values():
        if not cutout_module.contains_position(record.provenance.get("header") or {}, ra, dec):
            continue
        return (
            f"/api/cutout/{record.observation_id}?ra={ra}&dec={dec}"
            f"&fov=24&size=256"
        )
    return None


def _interaction_count() -> int:
    """Total social interactions, used to bust the feed cache when scoring changes."""
    from backend.storage import likes as likes_store
    from backend.storage import marks as marks_store

    return len(marks_store.list_marks()) + len(likes_store.list_likes())


def _feed_positions() -> list[tuple[float, float, str]]:
    """Candidate feed centers: fetched regions (exact) plus coarse 1-degree cells.

    Observation record centers are exposure pointings that scatter over
    degrees between visits of one target, so grouping must not rely on them;
    each candidate position is validated against real detector footprints
    afterwards.
    """
    from backend.storage import live_archive

    positions: list[tuple[float, float, str]] = []
    for key in live_archive.list_regions():
        try:
            ra_text, dec_text = key.split(",")
            positions.append((float(ra_text) % 360.0, float(dec_text), key))
        except ValueError:
            continue
    for record in _catalog().values():
        if record.ra is None or record.dec is None:
            continue
        cell_ra, cell_dec = round(record.ra), round(record.dec)
        if any(_angular_separation(cell_ra, cell_dec, ra, dec) < 0.7 for ra, dec, _ in positions):
            continue
        positions.append((float(cell_ra % 360), float(cell_dec), f"{cell_ra},{cell_dec}"))
    return positions


_feed_cache: dict[tuple[int, float, int], FeedResponse] = {}


@router.get("/feed", response_model=FeedResponse)
def feed(
    fov: float = Query(default=12.0, ge=0.5, le=60.0),
    limit: int = Query(default=40, ge=1, le=100),
) -> FeedResponse:
    """Scrollable tiles for the reel view: real sky positions with a verified multi-epoch series.

    Each tile is a position whose detector footprints actually contain it in
    at least two epochs of one band (same validation as /timeline). Regions
    are interleaved so scrolling varies, and offset tiles show more of each
    region than just its center.
    """
    cache_key = (len(_catalog()), fov, limit, _interaction_count())
    cached = _feed_cache.get(cache_key)
    if cached is not None:
        return cached

    from backend.storage import scoring

    scores = scoring.all_scores()
    records = list(_catalog().values())
    half_fov_deg = fov / 60.0 / 2.0
    per_region: list[list[FeedItem]] = []
    for center_ra, center_dec, key in _feed_positions():
        # Cheap prefilter: a SPHEREx detector spans ~3.5 degrees, so only
        # nearby exposures can possibly contain this position.
        nearby = [
            record
            for record in records
            if record.ra is not None
            and record.dec is not None
            and _angular_separation(center_ra, center_dec, record.ra, record.dec) < 3.0
        ]
        cos_dec = max(float(np.cos(np.deg2rad(center_dec))), 0.05)
        items: list[FeedItem] = []
        for dx, dy in ((0.0, 0.0), (1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)):
            tile_ra = (center_ra + dx * half_fov_deg / cos_dec) % 360.0
            tile_dec = float(np.clip(center_dec + dy * half_fov_deg, -90.0, 90.0))
            by_band: dict[str, list[ObservationResponse]] = {}
            for record in nearby:
                if cutout_module.contains_position(record.provenance.get("header") or {}, tile_ra, tile_dec):
                    by_band.setdefault(record.band or "unknown", []).append(record)
            if not by_band:
                continue
            band = max(by_band, key=lambda b: len({r.epoch for r in by_band[b]}))
            covering = by_band[band]
            if len({record.epoch for record in covering}) < 2:
                continue
            items.append(
                FeedItem(
                    ra=round(tile_ra, 5),
                    dec=round(tile_dec, 5),
                    fov_arcmin=fov,
                    band=band,
                    n_frames=len(covering),
                    region_key=key,
                    **scores.get(key, {"score": 0, "likes": 0}),
                )
            )
        if items:
            per_region.append(items)

    # Order regions by engagement score (highest first), then interleave the
    # offset tiles within each region so scrolling varies without hiding the
    # higher-scoring regions behind lower ones.
    per_region.sort(key=lambda items: items[0].score, reverse=True)
    interleaved: list[FeedItem] = []
    while per_region and len(interleaved) < limit:
        for items in list(per_region):
            interleaved.append(items.pop(0))
            if not items:
                per_region.remove(items)
            if len(interleaved) >= limit:
                break
    response = FeedResponse(
        status="ok" if interleaved else "empty",
        items=interleaved,
        caveats=[
            "Every tile replays real SPHEREx observations; nothing in the feed is synthetic.",
            "Tiles come from the locally cached regions — fetch more positions to grow the feed.",
            "Ordering reflects likes, not scientific significance.",
        ],
        message=None if interleaved else "No cached region has two epochs yet. Fetch a position from the archive first.",
    )
    if len(_feed_cache) >= 8:
        _feed_cache.pop(next(iter(_feed_cache)))
    _feed_cache[cache_key] = response
    return response


@router.get("/marks", response_model=MarksResponse)
def list_marks() -> MarksResponse:
    from backend.storage import marks as marks_store

    return MarksResponse(
        status="ok",
        marks=[MarkResponse(**mark) for mark in marks_store.list_marks()],
        caveats=["Flags are personal bookmarks for follow-up review, not detections."],
    )


@router.post("/marks", response_model=MarkResponse)
def create_mark(request: MarkCreateRequest) -> MarkResponse:
    """Save a user flag; a tapped in-frame spot is converted to sky coordinates server-side."""
    from backend.storage import marks as marks_store

    spot_ra = spot_dec = None
    if request.x_frac is not None and request.y_frac is not None:
        size = 256
        grid = cutout_module.aligned_grid_wcs(request.ra, request.dec, request.fov_arcmin, size)
        sky = grid.wcs_pix2world([[request.x_frac * size - 0.5, request.y_frac * size - 0.5]], 0)[0]
        spot_ra, spot_dec = round(float(sky[0]) % 360.0, 6), round(float(sky[1]), 6)
    preview_url = None
    if request.observation_id and request.observation_id in _catalog():
        preview_url = (
            f"/api/cutout/{request.observation_id}?ra={request.ra}&dec={request.dec}"
            f"&fov={request.fov_arcmin}&size=256"
        )
    note = request.note.strip() if request.note else None
    mark = marks_store.add_mark(
        {
            "ra": request.ra,
            "dec": request.dec,
            "spot_ra": spot_ra,
            "spot_dec": spot_dec,
            "fov_arcmin": request.fov_arcmin,
            "band": request.band,
            "observation_id": request.observation_id,
            "epoch": request.epoch,
            "note": note or None,
            "source": request.source,
            "region_key": request.region_key,
            "preview_url": preview_url,
        }
    )
    return MarkResponse(**mark)


@router.delete("/marks/{mark_id}")
def delete_mark(mark_id: str) -> dict[str, str]:
    from backend.storage import marks as marks_store

    if not marks_store.delete_mark(mark_id):
        raise HTTPException(status_code=404, detail=f"unknown mark: {mark_id}")
    return {"status": "deleted", "id": mark_id}


@router.post("/likes", response_model=LikeResponse)
def create_like(request: LikeCreateRequest) -> LikeResponse:
    """Record a like on a sky region."""
    from backend.storage import likes as likes_store

    like = likes_store.add_like(request.region_key)
    return LikeResponse(**like)


@router.get("/likes", response_model=LikesResponse)
def get_likes(region_key: str = Query(..., max_length=64)) -> LikesResponse:
    """How many times this sky region has been liked."""
    from backend.storage import likes as likes_store

    return LikesResponse(
        status="ok",
        region_key=region_key,
        count=likes_store.count_likes(region_key),
    )


@router.get("/survey", response_model=SurveyResponse)
def survey() -> SurveyResponse:
    """Likes-based ranking of every sky region with any likes.

    Regions are ranked by their like count, highest first. This is a social
    leaderboard, not a scientific ranking: more likes means more people found
    it interesting, not that the sky there is objectively special.
    """
    from backend.storage import scoring

    items: list[SurveyItem] = []
    for region_key, breakdown in scoring.all_scores().items():
        try:
            ra_text, dec_text = region_key.split(",", 1)
            ra, dec = float(ra_text) % 360.0, float(dec_text)
        except ValueError:
            continue
        preview_url = _region_preview_url(ra, dec)
        items.append(
            SurveyItem(
                region_key=region_key,
                ra=ra,
                dec=dec,
                score=breakdown["score"],
                likes=breakdown["likes"],
                preview_url=preview_url,
            )
        )
    items.sort(key=lambda item: item.score, reverse=True)
    return SurveyResponse(
        status="ok" if items else "empty",
        regions=items,
        caveats=[
            "This is a likes-based leaderboard, not a scientific ranking.",
            "Score = number of likes.",
        ],
    )


@router.get("/gaia", response_model=GaiaOverlayResponse)
def gaia_overlay(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    fov: float = Query(default=15.0, ge=0.5, le=240.0, description="field of view in arcminutes"),
) -> GaiaOverlayResponse:
    """Catalogued Gaia DR3 stars inside the aligned cutout frame at (ra, dec).

    Positions are projected through the same WCS grid the cutout PNGs use, so
    the frontend can overlay known stars without doing any sky math. Live ESA
    archive query with a disk cache (offline-demo safe); when neither works
    the endpoint says so instead of returning an empty sky.
    """
    from backend.storage import gaia

    try:
        sources, provenance = gaia.cone_search(ra, dec, radius_arcmin=fov * 0.75)
    except gaia.GaiaUnavailableError as error:
        return GaiaOverlayResponse(
            status="unavailable",
            ra=ra,
            dec=dec,
            fov_arcmin=fov,
            message=f"Gaia DR3 catalog is unreachable and not cached for this region ({error}).",
        )

    size = 256  # fractional positions are size-independent; any grid works
    grid = cutout_module.aligned_grid_wcs(ra, dec, fov, size)
    in_frame: list[GaiaSourceResponse] = []
    if sources:
        pixels = grid.wcs_world2pix([[source.ra, source.dec] for source in sources], 0)
        for source, (x, y) in zip(sources, pixels):
            if not (np.isfinite(x) and np.isfinite(y)):
                continue
            x_frac, y_frac = (float(x) + 0.5) / size, (float(y) + 0.5) / size
            if not (0.0 <= x_frac <= 1.0 and 0.0 <= y_frac <= 1.0):
                continue
            in_frame.append(
                GaiaSourceResponse(
                    source_id=source.source_id,
                    ra=source.ra,
                    dec=source.dec,
                    g_mag=source.g_mag,
                    pm_total_mas_yr=None if source.pm_total is None else round(source.pm_total, 2),
                    variable_flag=source.variable_flag,
                    x_frac=round(x_frac, 4),
                    y_frac=round(y_frac, 4),
                )
            )
    return GaiaOverlayResponse(
        status="ok",
        ra=ra,
        dec=dec,
        fov_arcmin=fov,
        sources=in_frame,
        provenance=provenance,
        caveats=[
            "Gaia DR3 is an optical catalog: very red, dust-obscured, or solar-system objects can be "
            "bright in SPHEREx's infrared yet absent here.",
            "Only the brightest 200 catalog stars in the search radius are considered.",
        ],
    )


_spectrum_cache: dict[tuple[float, float, int], SpectrumResponse] = {}


@router.get("/spectrum", response_model=SpectrumResponse)
def spectrum(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
) -> SpectrumResponse:
    """Approximate infrared spectrum at a position, assembled across observations.

    SPHEREx's six detectors each see a different slice of 0.75-5 µm, so the
    median surface brightness in a small box at (ra, dec), gathered from every
    observation covering the position, sketches the source's spectrum.
    """
    # Keyed on catalog size so newly scraped observations invalidate the cache.
    key = (round(ra, 5), round(dec, 5), len(_catalog()))
    cached = _spectrum_cache.get(key)
    if cached is not None:
        return cached

    points: list[SpectrumPoint] = []
    for record in _catalog().values():
        header = record.provenance.get("header") or {}
        if record.wavelength is None or not cutout_module.contains_position(header, ra, dec):
            continue
        try:
            # 1-arcmin box sampled at ~3.75"/px: fine enough that the central
            # aperture actually lands on the source instead of empty sky.
            _, aligned = _aligned_cutout(record.observation_id, ra, dec, 1.0, 16)
        except HTTPException:
            continue
        values = aligned.image[aligned.valid_mask]
        if values.size == 0:
            continue
        # Source brightness = peak of the 1-arcmin box minus its median
        # background. The peak (not the median, which measures empty sky and
        # flattens every curve) tracks the target even when a saturated core
        # is masked, since the bright wings still dominate the box.
        background = float(np.median(values))
        points.append(
            SpectrumPoint(
                observation_id=record.observation_id,
                epoch=record.epoch,
                band=record.band,
                wavelength=record.wavelength,
                surface_brightness=max(float(values.max()) - background, 0.0),
            )
        )
    points.sort(key=lambda point: point.wavelength)
    response = SpectrumResponse(
        status="ok" if points else "no_matching_observations",
        ra=ra,
        dec=dec,
        points=points,
        caveats=[
            "Each point is the peak brightness in a ~20-arcsecond aperture at the crosshair, minus the local background, from one real observation.",
            "Very bright stars saturate SPHEREx pixels; their masked cores can make peak values unreliable.",
            "The wavelength shown is the detector's representative value; SPHEREx filters vary across each detector, so treat it as approximate.",
            "This is a quick-look measurement, not calibrated photometry.",
        ],
        message=None if points else "No cached observation covers this position.",
    )
    if len(_spectrum_cache) >= 64:
        _spectrum_cache.pop(next(iter(_spectrum_cache)))
    _spectrum_cache[key] = response
    return response


@router.post("/diff", response_model=AnalyzeResponse)
def difference(request: AnalyzeRequest) -> AnalyzeResponse:
    return _analyze(request)


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    return _analyze(request)
