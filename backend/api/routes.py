"""FastAPI routes backed by the local cached observation catalog."""

from __future__ import annotations

import time
from io import BytesIO
from datetime import datetime
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from PIL import Image
from scipy import ndimage

from backend import storage
from backend.api.schemas import AnalyzeRequest, AnalyzeResponse, EpochsResponse, ObservationResponse
from backend.astronomy import render
from backend.astronomy.difference import significance_map

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
    image.save(payload, format="PNG", optimize=True)
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


@router.post("/diff", response_model=AnalyzeResponse)
def difference(request: AnalyzeRequest) -> AnalyzeResponse:
    return _analyze(request)


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    return _analyze(request)
