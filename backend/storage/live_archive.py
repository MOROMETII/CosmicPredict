"""On-demand retrieval of SPHEREx cutouts from the live IRSA archive.

The full archive is far too large to mirror (each Level-2 image is ~65 MB and
there are millions), but IRSA's IBE file server supports server-side cutouts:
appending ``?center=<ra>,<dec>&size=<n>arcmin`` to a product URL returns just
that patch (a few MB) with every HDU — science, variance, flags — and a valid
WCS. This module queries the SIA catalog for a position, picks a time-spread,
single-band sample of observations, downloads their cutouts into ``data/raw``
(where the local provider picks them up like any cached file), and remembers
fetched regions in a small ledger so repeat requests are instant.

Politeness: bounded frame counts, a delay between downloads, and a ledger to
avoid re-querying. The cached/offline demo path never depends on this module.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io.votable import parse

from backend import config

SIA_COLLECTIONS = ("spherex_dr1", "spherex_qr3")
SIA_BASE = "https://irsa.ipac.caltech.edu/SIA?COLLECTION={collection}"
_USER_AGENT = "cosmic-predict-live/0.1"
_LEDGER_NAME = "live_regions.json"

# Snap requested positions to a coarse grid so nearby queries share cutouts.
_GRID_DEG = 0.02  # ~1.2 arcmin


class LiveArchiveError(RuntimeError):
    """Raised when the live IRSA query or download fails."""


def _snap(value: float) -> float:
    return round(round(value / _GRID_DEG) * _GRID_DEG, 4)


def _ledger_path() -> Path:
    return config.RAW_DIR / _LEDGER_NAME


def _read_ledger() -> dict[str, Any]:
    path = _ledger_path()
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return {"regions": {}}


def _write_ledger(ledger: dict[str, Any]) -> None:
    path = _ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ledger, indent=1), encoding="utf-8")


def _query_sia(ra: float, dec: float, radius_deg: float, timeout: float) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for collection in SIA_COLLECTIONS:
        params = urllib.parse.urlencode(
            {"POS": f"CIRCLE {ra} {dec} {radius_deg}", "MAXREC": "2000"}
        )
        url = f"{SIA_BASE.format(collection=collection)}&{params}"
        request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
            votable = parse(BytesIO(payload), verify="ignore")
            tables = list(votable.iter_tables())
            if not tables:
                continue
            # use_names_over_ids keeps the real SIA field names (t_min, s_ra, ...).
            table = tables[0].to_table(use_names_over_ids=True)
        except Exception as error:  # noqa: BLE001 - one collection down should not kill the fetch
            print(f"live SIA query failed for {collection}: {error}")
            continue
        for row in table:
            record: dict[str, Any] = {}
            for column in table.colnames:
                value = row[column]
                record[column] = None if np.ma.is_masked(value) else value
            records.append(record)
    return records


def _text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def _mjd_month(mjd: float) -> str:
    seconds = (float(mjd) - 40587.0) * 86400.0
    return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m")


def _select_frames(
    records: list[dict[str, Any]], ra: float, dec: float, max_frames: int
) -> list[dict[str, Any]]:
    """One well-centered record per month, in the band with the best month spread."""
    usable = []
    for record in records:
        try:
            if _text(record.get("dataproduct_type")) != "image":
                continue
            access_url = _text(record.get("access_url"))
            if not access_url.startswith("http"):
                continue
            usable.append(
                {
                    "url": access_url,
                    "band": _text(record.get("energy_bandpassname")),
                    "month": _mjd_month(float(record["t_min"])),
                    "s_ra": float(record["s_ra"]),
                    "s_dec": float(record["s_dec"]),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    by_band: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for item in usable:
        by_band.setdefault(item["band"], {}).setdefault(item["month"], []).append(item)
    if not by_band:
        return []
    band = max(by_band, key=lambda b: (len(by_band[b]), sum(len(v) for v in by_band[b].values())))

    def separation(item: dict[str, Any]) -> float:
        d_ra = (item["s_ra"] - ra) * np.cos(np.deg2rad(dec))
        return float(np.hypot(d_ra, item["s_dec"] - dec))

    frames = [min(group, key=separation) for _, group in sorted(by_band[band].items())]
    if len(frames) > max_frames:
        step = len(frames) / max_frames
        frames = [frames[int(index * step)] for index in range(max_frames)]
    return frames


def fetch_region(
    ra: float,
    dec: float,
    *,
    size_arcmin: float = 24.0,
    max_frames: int = 8,
    delay_seconds: float = 1.0,
    timeout: float = 90.0,
) -> dict[str, Any]:
    """Download time-spread cutouts of (ra, dec) from IRSA into the local cache.

    Returns a summary dict; raises LiveArchiveError when nothing was fetched.
    """
    ra_snap, dec_snap = _snap(ra % 360.0), _snap(dec)
    region_key = f"{ra_snap},{dec_snap}"
    ledger = _read_ledger()
    known = ledger["regions"].get(region_key)
    if known:
        return {"status": "already_fetched", "region": region_key, **known}

    records = _query_sia(ra_snap, dec_snap, radius_deg=0.02, timeout=timeout)
    frames = _select_frames(records, ra_snap, dec_snap, max_frames)
    if not frames:
        raise LiveArchiveError(
            "The IRSA archive returned no SPHEREx images covering this position yet."
        )

    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    downloaded: list[str] = []
    for index, frame in enumerate(frames):
        stem = re.sub(r"[^A-Za-z0-9_]", "", Path(urllib.parse.urlparse(frame["url"]).path).stem)[-48:]
        coord_tag = f"{ra_snap:.4f}_{dec_snap:.4f}".replace(".", "p").replace("-", "m")
        filename = f"live_{coord_tag}_{stem}.fits"
        destination = config.RAW_DIR / filename
        if destination.exists():
            downloaded.append(filename)
            continue
        cutout_url = f"{frame['url']}?center={ra_snap},{dec_snap}&size={size_arcmin}arcmin"
        request = urllib.request.Request(cutout_url, headers={"User-Agent": _USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
        except Exception as error:  # noqa: BLE001 - skip failing frames, keep the rest
            print(f"live cutout download failed ({frame['month']}): {error}")
            continue
        temporary = destination.with_suffix(".part")
        temporary.write_bytes(payload)
        temporary.replace(destination)
        downloaded.append(filename)
        if index < len(frames) - 1 and delay_seconds > 0:
            time.sleep(delay_seconds)

    if not downloaded:
        raise LiveArchiveError("Every cutout download from the IRSA archive failed. Try again shortly.")

    summary = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "frames": len(downloaded),
        "files": downloaded,
        "size_arcmin": size_arcmin,
    }
    ledger["regions"][region_key] = summary
    _write_ledger(ledger)
    return {"status": "fetched", "region": region_key, **summary}
