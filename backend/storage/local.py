"""Local filesystem fallback catalog for cached FITS observations."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from backend import config
from backend.astronomy.fits_loader import load_fits_observation

# Sidecar metadata files let the catalog list dozens of multi-MB FITS files
# without re-parsing each one on every request.
_SIDECAR_SUFFIX = ".meta.json"
_SIDECAR_FORMAT = 2  # bump when _record_from_path output changes


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
        # Files fetched on demand from the live IRSA archive are prefixed
        # "live_" so the UI can label their provenance distinctly.
        "source": "live" if path.stem.startswith("live_") else "cached",
    }


def _cached_record(path: Path) -> dict[str, Any]:
    """Return the observation record for one FITS file, via its sidecar cache."""
    sidecar = path.with_name(path.name + _SIDECAR_SUFFIX)
    mtime = path.stat().st_mtime
    if sidecar.is_file():
        try:
            payload = json.loads(sidecar.read_text(encoding="utf-8"))
            if payload.get("format") == _SIDECAR_FORMAT and payload.get("mtime") == mtime:
                return payload["record"]
        except (OSError, ValueError, KeyError, TypeError):
            pass  # unreadable sidecar: rebuild it below
    record = _record_from_path(path)
    try:
        sidecar.write_text(
            json.dumps({"format": _SIDECAR_FORMAT, "mtime": mtime, "record": record}),
            encoding="utf-8",
        )
    except (OSError, TypeError) as error:
        print(f"could not write metadata sidecar for {path.name}: {error}", file=sys.stderr)
    return record


def list_observations() -> list[dict[str, Any]]:
    raw_dir = config.RAW_DIR
    if not raw_dir.is_dir():
        return []
    records: list[dict[str, Any]] = []
    for path in sorted(raw_dir.glob("*.fits")):
        try:
            records.append(_cached_record(path))
        except (OSError, ValueError, TypeError) as error:
            print(f"skipping unreadable observation {path.name}: {error}", file=sys.stderr)
            continue
    return records


def get_observation(observation_id: str) -> dict[str, Any] | None:
    for record in list_observations():
        if record["observation_id"] == observation_id:
            return record
    return None
