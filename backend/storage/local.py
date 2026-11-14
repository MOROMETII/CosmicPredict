"""Local filesystem fallback catalog for cached FITS observations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend import config
from backend.astronomy.fits_loader import load_fits_observation


def _epoch_from_header(header: dict[str, Any]) -> str | None:
    value = header.get("DATE-OBS")
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if "+" not in text and text.count(":") >= 2:
        text += "+00:00"
    return text


def _record_from_path(path: Path) -> dict[str, Any]:
    observation = load_fits_observation(path)
    header = observation.header
    detector = header.get("DETECTOR")
    band = str(detector) if detector is not None else header.get("BAND")
    wavelength = header.get("WAVELENGTH")
    return {
        "observation_id": path.stem,
        "source_url": None,
        "query_url": None,
        "retrieved_at": None,
        "epoch": _epoch_from_header(header),
        "band": band,
        "wavelength": wavelength,
        "ra": header.get("CRVAL1"),
        "dec": header.get("CRVAL2"),
        "header": header,
        "local_path": path.name,
        "storage_path": None,
        "preview_storage_path": None,
        "asset_status": "preview_available",
        "source": "cached",
    }


def list_observations() -> list[dict[str, Any]]:
    raw_dir = config.RAW_DIR
    if not raw_dir.is_dir():
        return []
    records: list[dict[str, Any]] = []
    for path in sorted(raw_dir.glob("*.fits")):
        try:
            records.append(_record_from_path(path))
        except (OSError, ValueError, TypeError):
            continue
    return records


def get_observation(observation_id: str) -> dict[str, Any] | None:
    for record in list_observations():
        if record["observation_id"] == observation_id:
            return record
    return None
