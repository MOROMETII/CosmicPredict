"""FastAPI routes backed by the local cached observation catalog."""

from __future__ import annotations

import os
import time
from io import BytesIO
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from PIL import Image
from scipy import ndimage

from backend import storage
from backend.ai.inference import JEPAInference
from backend.api.schemas import AnalyzeRequest, AnalyzeResponse, EpochsResponse, ObservationResponse
from backend.astronomy.calibration import robust_normalize
from backend.astronomy.fits_loader import load_fits_observation

ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT = ROOT / "models" / "checkpoints" / "jepa.pt"

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
        records[observation_id] = ObservationResponse(
            observation_id=observation_id,
            epoch=_parse_epoch(record.get("epoch")),
            band=str(record["band"]) if record.get("band") is not None else None,
            ra=float(record["ra"]) if record.get("ra") is not None else None,
            dec=float(record["dec"]) if record.get("dec") is not None else None,
            source=record.get("source") or "cached",
            provenance={
                "source_path": record.get("local_path"),
                "storage_path": record.get("storage_path"),
                "header": record.get("header") or {},
            },
            image_url=f"/api/images/{observation_id}/preview",
            asset_status=record.get("asset_status") or "preview_available",
        )
    _catalog_cache["records"] = records
    _catalog_cache["expires_at"] = now + _CATALOG_TTL_SECONDS
    return records


def _load_patch(observation_id: str, row: int, column: int, size: int) -> np.ndarray:
    if observation_id not in _catalog():
        raise HTTPException(status_code=404, detail=f"unknown observation: {observation_id}")
    path = storage.resolve_asset_path(observation_id)
    calibrated = robust_normalize(load_fits_observation(path))
    end_row, end_column = row + size, column + size
    if end_row > calibrated.image.shape[0] or end_column > calibrated.image.shape[1]:
        raise HTTPException(status_code=422, detail="requested patch exceeds image bounds")
    return calibrated.image[row:end_row, column:end_column]


def _false_color(values: np.ndarray) -> Image.Image:
    finite = np.isfinite(values)
    if not finite.any():
        raise ValueError("image has no finite pixels")
    valid = values[finite]
    lower, upper = np.percentile(valid, [1.0, 99.5])
    stretched = np.clip((values - lower) / max(upper - lower, 1e-6), 0, 1)
    stretched = np.arcsinh(stretched * 8) / np.arcsinh(8)
    stops = np.array(
        [[3, 8, 24], [20, 72, 120], [64, 185, 190], [246, 190, 86], [255, 242, 190]],
        dtype=np.float32,
    )
    positions = np.linspace(0, 1, len(stops))
    rgb = np.stack(
        [np.interp(stretched, positions, stops[:, channel]) for channel in range(3)],
        axis=-1,
    ).astype(np.uint8)
    rgb[~finite] = [0, 0, 0]
    return Image.fromarray(rgb, mode="RGB")


def _png_response(image: Image.Image) -> Response:
    payload = BytesIO()
    image.save(payload, format="PNG", optimize=True)
    return Response(content=payload.getvalue(), media_type="image/png")


def _checkpoint_path() -> Path:
    return Path(os.environ.get("JEPA_CHECKPOINT", CHECKPOINT))


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
        raise HTTPException(status_code=422, detail="observations use incompatible bands")
    if None not in (context.ra, context.dec, target.ra, target.dec):
        separation = _angular_separation(context.ra, context.dec, target.ra, target.dec)
        if separation > 0.1:
            raise HTTPException(
                status_code=422,
                detail=f"observations do not cover the same cached region ({separation:.3f} degrees apart)",
            )
    return context, target


@lru_cache(maxsize=1)
def _jepa_inference(checkpoint: str) -> JEPAInference:
    return JEPAInference.from_checkpoint(checkpoint)


def _jepa_status() -> dict[str, Any]:
    checkpoint = _checkpoint_path()
    if not checkpoint.is_file():
        return {
            "status": "unavailable",
            "enabled": False,
            "checkpoint": None,
            "message": "No trained JEPA checkpoint is configured.",
        }
    try:
        _jepa_inference(str(checkpoint.resolve()))
    except (OSError, RuntimeError, ValueError, TypeError) as error:
        return {
            "status": "error",
            "enabled": False,
            "checkpoint": str(checkpoint.relative_to(ROOT)),
            "message": f"Trained JEPA checkpoint could not be loaded: {error}",
        }
    return {
        "status": "ready",
        "enabled": True,
        "checkpoint": str(checkpoint.relative_to(ROOT)),
        "message": None,
    }


def _candidates_from_map(
    score_map: np.ndarray,
    *,
    source: str,
    coordinate_space: str,
    minimum_area: int = 2,
    maximum_candidates: int = 50,
) -> list[dict[str, Any]]:
    finite = np.isfinite(score_map)
    values = score_map[finite]
    if values.size == 0:
        return []
    threshold = max(float(np.percentile(values, 99.0)), float(values.mean() + 3.0 * values.std()))
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
        "jepa": _jepa_status(),
    }


@router.get("/epochs", response_model=EpochsResponse)
def epochs(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
) -> EpochsResponse:
    observations = [
        observation
        for observation in _catalog().values()
        if observation.ra is not None
        and observation.dec is not None
        and _angular_separation(ra, dec, observation.ra, observation.dec) <= 0.1
    ]
    return EpochsResponse(
        status="cached_region_match" if observations else "no_cached_region_match",
        observations=observations,
        message=(
            "Cached observations are selected by center separation within 0.1 degrees. "
            "Full WCS footprint validation is not available for this fixture."
            if observations
            else f"No cached observation centers are within 0.1 degrees of RA={ra}, Dec={dec}."
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
    if observation_id not in _catalog():
        raise HTTPException(status_code=404, detail=f"unknown observation: {observation_id}")
    try:
        path = storage.resolve_asset_path(observation_id)
        observation = load_fits_observation(path)
        png = _false_color(observation.image)
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
    context = _load_patch(context_epoch, row, column, size)
    target = _load_patch(target_epoch, row, column, size)
    return _png_response(_false_color(np.abs(target - context)))


@router.get("/images", response_model=list[ObservationResponse])
def images() -> list[ObservationResponse]:
    return list(_catalog().values())


def _analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    _validate_pair(request.context_epoch, request.target_epoch)
    context = _load_patch(request.context_epoch, request.row, request.column, request.size)
    target = _load_patch(request.target_epoch, request.row, request.column, request.size)
    difference_score = float(np.mean(np.abs(target - context)))
    difference_map = np.abs(target - context)
    difference_image_url = (
        f"/api/diff/preview?context_epoch={request.context_epoch}"
        f"&target_epoch={request.target_epoch}&row={request.row}"
        f"&column={request.column}&size={request.size}"
    )
    if not request.run_jepa:
        return AnalyzeResponse(
            status="ok",
            context_epoch=request.context_epoch,
            target_epoch=request.target_epoch,
            difference_score=difference_score,
            difference_image_url=difference_image_url,
            candidates=_candidates_from_map(
                difference_map,
                source="difference",
                coordinate_space="image_patch_pixel",
            ),
            caveats=["Difference score is a simplified normalized pixel baseline."],
        )
    jepa_status = _jepa_status()
    if not jepa_status["enabled"]:
        return AnalyzeResponse(
            status="jepa_unavailable",
            context_epoch=request.context_epoch,
            target_epoch=request.target_epoch,
            difference_score=difference_score,
            difference_image_url=difference_image_url,
            candidates=_candidates_from_map(
                difference_map,
                source="difference",
                coordinate_space="image_patch_pixel",
            ),
            jepa_status=jepa_status["status"],
            caveats=["No trained JEPA checkpoint is configured."],
            message=jepa_status["message"],
        )
    inference = _jepa_inference(str(_checkpoint_path().resolve()))
    result = inference.run(context, target)
    anomaly_map = None if result.anomaly_map is None else result.anomaly_map[0].tolist()
    candidates = _candidates_from_map(
        difference_map,
        source="difference",
        coordinate_space="image_patch_pixel",
    )
    if result.anomaly_map is not None:
        candidates.extend(
            _candidates_from_map(
                result.anomaly_map[0],
                source="jepa",
                coordinate_space="latent_patch_grid",
                minimum_area=1,
            )
        )
    return AnalyzeResponse(
        status=result.status,
        context_epoch=request.context_epoch,
        target_epoch=request.target_epoch,
        difference_score=difference_score,
        difference_image_url=difference_image_url,
        jepa_score=result.jepa_score,
        score_kind=result.score_kind,
        anomaly_map=anomaly_map,
        jepa_status=jepa_status["status"],
        candidates=candidates,
        caveats=["JEPA score is experimental and is not a probability or confirmation."],
        message=result.message,
    )


@router.post("/diff", response_model=AnalyzeResponse)
def difference(request: AnalyzeRequest) -> AnalyzeResponse:
    request.run_jepa = False
    return _analyze(request)


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    return _analyze(request)
