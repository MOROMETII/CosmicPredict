"""Gaia DR3 cone searches for cross-matching SPHEREx change candidates.

Gaia Data Release 3 (ESA) is the reference star catalog: if a flagged change
coincides with a catalogued Gaia star, it is most plausibly a known star
varying or drifting; if nothing is catalogued there, the candidate is *not*
explained by the star catalog, which is exactly what makes it interesting for
a Planet X-style search (a faint, cold solar-system body would not be in
Gaia's optical catalog).

Queries go to the ESA Gaia archive's TAP sync endpoint and every result is
cached on disk, so demo regions keep working offline after one live query.
This module never fabricates sources: when the archive is unreachable and no
cache exists, it reports unavailability.
"""

from __future__ import annotations

import json
import re
import threading
import urllib.parse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend import config
from backend.http_util import http_get

GAIA_TAP_SYNC = "https://gea.esac.esa.int/tap-server/tap/sync"
_MAX_SOURCES = 200
_CACHE_DIR_NAME = "gaia"


class GaiaUnavailableError(RuntimeError):
    """Raised when the Gaia archive is unreachable and no cache exists."""


@dataclass(frozen=True)
class GaiaSource:
    source_id: str
    ra: float
    dec: float
    g_mag: float | None
    pm_ra: float | None  # proper motion in RA*cos(dec), mas/yr
    pm_dec: float | None  # proper motion in Dec, mas/yr
    parallax: float | None  # mas
    variable_flag: str | None  # NOT_AVAILABLE | CONSTANT | VARIABLE

    @property
    def pm_total(self) -> float | None:
        if self.pm_ra is None or self.pm_dec is None:
            return None
        return float((self.pm_ra**2 + self.pm_dec**2) ** 0.5)


_cache_lock = threading.Lock()


def _cache_dir() -> Path:
    return config.RAW_DIR.parent / _CACHE_DIR_NAME


def _cache_path(ra: float, dec: float, radius_arcmin: float) -> Path:
    stem = f"gaia_{ra:.4f}_{dec:.4f}_{radius_arcmin:.1f}"
    return _cache_dir() / (re.sub(r"[^A-Za-z0-9_.-]", "", stem.replace("-", "m")) + ".json")


def _adql(ra: float, dec: float, radius_deg: float) -> str:
    return (
        f"SELECT TOP {_MAX_SOURCES} source_id, ra, dec, phot_g_mean_mag, pmra, pmdec, "
        "parallax, phot_variable_flag "
        "FROM gaiadr3.gaia_source "
        f"WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_deg:.6f})) "
        "ORDER BY phot_g_mean_mag ASC"
    )


def _parse_tap_json(payload: bytes) -> list[GaiaSource]:
    document = json.loads(payload)
    columns = [meta["name"].lower() for meta in document.get("metadata", [])]
    index = {name: position for position, name in enumerate(columns)}
    sources: list[GaiaSource] = []

    def field(row: list[Any], name: str) -> Any:
        position = index.get(name)
        return None if position is None else row[position]

    for row in document.get("data", []):
        try:
            sources.append(
                GaiaSource(
                    source_id=str(field(row, "source_id")),
                    ra=float(field(row, "ra")),
                    dec=float(field(row, "dec")),
                    g_mag=None if field(row, "phot_g_mean_mag") is None else float(field(row, "phot_g_mean_mag")),
                    pm_ra=None if field(row, "pmra") is None else float(field(row, "pmra")),
                    pm_dec=None if field(row, "pmdec") is None else float(field(row, "pmdec")),
                    parallax=None if field(row, "parallax") is None else float(field(row, "parallax")),
                    variable_flag=None if field(row, "phot_variable_flag") is None else str(field(row, "phot_variable_flag")),
                )
            )
        except (TypeError, ValueError):
            continue
    return sources


def cone_search(
    ra: float, dec: float, radius_arcmin: float, *, timeout: float = 25.0
) -> tuple[list[GaiaSource], dict[str, Any]]:
    """Catalogued Gaia DR3 sources within ``radius_arcmin`` of (ra, dec).

    Returns ``(sources, provenance)``. Cache-first: a previously stored result
    is served immediately (and keeps the offline demo working); otherwise the
    live ESA archive is queried and the result stored. Raises
    :class:`GaiaUnavailableError` when neither is possible.
    """
    path = _cache_path(ra % 360.0, dec, radius_arcmin)
    with _cache_lock:
        if path.is_file():
            try:
                document = json.loads(path.read_text(encoding="utf-8"))
                sources = [GaiaSource(**entry) for entry in document["sources"]]
                return sources, dict(document.get("provenance") or {}, cache="hit")
            except (OSError, TypeError, ValueError, KeyError):
                pass  # unreadable cache: fall through to a live query

    query = urllib.parse.urlencode(
        {
            "REQUEST": "doQuery",
            "LANG": "ADQL",
            "FORMAT": "json",
            "QUERY": _adql(ra % 360.0, dec, radius_arcmin / 60.0),
        }
    )
    try:
        payload = http_get(f"{GAIA_TAP_SYNC}?{query}", timeout=timeout, attempts=2)
        sources = _parse_tap_json(payload)
    except Exception as error:  # noqa: BLE001 - any failure means "catalog unavailable", never fabricate
        raise GaiaUnavailableError(f"Gaia archive query failed: {error}") from error

    provenance = {
        "catalog": "Gaia DR3 (ESA)",
        "service": GAIA_TAP_SYNC,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "radius_arcmin": radius_arcmin,
        "max_sources": _MAX_SOURCES,
    }
    with _cache_lock:
        try:
            _cache_dir().mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps({"provenance": provenance, "sources": [asdict(source) for source in sources]}),
                encoding="utf-8",
            )
        except OSError:
            pass  # cache write failure must not break the response
    return sources, dict(provenance, cache="miss")
