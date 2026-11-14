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

The SIA-discovery + IBE-cutout access pattern follows the official SPHEREx
tutorial notebooks (https://caltech-ipac.github.io/irsa-tutorials/).
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io.votable import parse

from backend import config
from backend.http_util import http_get, USER_AGENT

SIA_COLLECTIONS = ("spherex_dr1", "spherex_qr3")
SIA_BASE = "https://irsa.ipac.caltech.edu/SIA?COLLECTION={collection}"
_LEDGER_NAME = "live_regions.json"
_USER_AGENT = USER_AGENT
# Bump when the fetch strategy changes so stale (incomplete) ledgers are
# discarded and regions re-fetch under the new rules.
_LEDGER_VERSION = 2

# Transient HTTP statuses worth retrying with exponential backoff. IRSA's IBE
# cutout server returns "503 Server busy, retry later" (with Retry-After) while
# a cutout is generated on demand, so a single failure is not meaningful — retry
# politely, growing the wait each attempt, before giving up.
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_RETRY_BASE_DELAY = 5.0
_RETRY_MAX_DELAY = 60.0
_RETRY_ATTEMPTS = 5

# Snap requested positions to a coarse grid so nearby queries share cutouts.
_GRID_DEG = 0.02  # ~1.2 arcmin


class LiveArchiveError(RuntimeError):
    """Raised when the live IRSA query or download fails."""


# Retry transient IRSA failures (503s, timeouts) via the shared helper.
_http_get = http_get


def _snap(value: float) -> float:
    return round(round(value / _GRID_DEG) * _GRID_DEG, 4)


_ledger_lock = threading.Lock()


def _ledger_path() -> Path:
    return config.RAW_DIR / _LEDGER_NAME


def list_regions() -> dict[str, Any]:
    """The regions fetched on demand so far, keyed by "ra,dec" (snapped)."""
    return dict(_read_ledger().get("regions") or {})


def _read_ledger() -> dict[str, Any]:
    path = _ledger_path()
    if path.is_file():
        try:
            ledger = json.loads(path.read_text(encoding="utf-8"))
            if ledger.get("version") == _LEDGER_VERSION:
                return ledger
        except (OSError, ValueError):
            pass
    return {"version": _LEDGER_VERSION, "regions": {}}


def _write_ledger(ledger: dict[str, Any]) -> None:
    path = _ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({**ledger, "version": _LEDGER_VERSION}, indent=1), encoding="utf-8")


def _open_with_retry(request: urllib.request.Request, *, timeout: float) -> Any:
    """Open a request, retrying transient failures with polite backoff.

    The wait grows each attempt but never shrinks below the server's Retry-After
    hint, so a "Server busy" 503 is given progressively more time to clear.
    """
    last_error: Exception | None = None
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code in _RETRYABLE_STATUS and attempt < _RETRY_ATTEMPTS - 1:
                backoff = _RETRY_BASE_DELAY * (2 ** attempt)
                retry_after = error.headers.get("Retry-After") if error.headers else None
                try:
                    wait = min(max(backoff, float(retry_after)), _RETRY_MAX_DELAY) if retry_after else min(backoff, _RETRY_MAX_DELAY)
                except ValueError:
                    wait = min(backoff, _RETRY_MAX_DELAY)
                print(f"transient HTTP {error.code}; retrying in {wait:.1f}s")
                time.sleep(wait)
                last_error = error
                continue
            raise
        except urllib.error.URLError as error:
            if attempt < _RETRY_ATTEMPTS - 1:
                wait = min(_RETRY_BASE_DELAY * (2 ** attempt), _RETRY_MAX_DELAY)
                print(f"connection error {error}; retrying in {wait:.1f}s")
                time.sleep(wait)
                last_error = error
                continue
            raise
    raise last_error  # type: ignore[misc]


def _query_sia(ra: float, dec: float, radius_deg: float, timeout: float) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for collection in SIA_COLLECTIONS:
        params = urllib.parse.urlencode(
            {"POS": f"CIRCLE {ra} {dec} {radius_deg}", "MAXREC": "2000"}
        )
        url = f"{SIA_BASE.format(collection=collection)}&{params}"
        request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        try:
            with _open_with_retry(request, timeout=timeout) as response:
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
    """One well-centered record per (band, month), across every detector band.

    SPHEREx re-visits a position in all six detectors each survey pass, so a
    position is only "complete" when every band's months are represented. We
    keep the best-centered exposure for each (band, month) pair, then thin to
    ``max_frames`` with even spacing if the archive is exceptionally dense.
    """
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

    def separation(item: dict[str, Any]) -> float:
        d_ra = (item["s_ra"] - ra) * np.cos(np.deg2rad(dec))
        return float(np.hypot(d_ra, item["s_dec"] - dec))

    by_band_month: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for item in usable:
        by_band_month.setdefault((item["band"], item["month"]), []).append(item)
    if not by_band_month:
        return []
    frames = [min(group, key=separation) for _, group in sorted(by_band_month.items())]
    if len(frames) > max_frames:
        step = len(frames) / max_frames
        frames = [frames[int(index * step)] for index in range(max_frames)]
    return frames


def fetch_region(
    ra: float,
    dec: float,
    *,
    size_arcmin: float = 24.0,
    max_frames: int = 48,
    delay_seconds: float = 0.5,
    timeout: float = 45.0,
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
            with _open_with_retry(request, timeout=timeout) as response:
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
    with _ledger_lock:
        ledger = _read_ledger()
        ledger["regions"][region_key] = summary
        _write_ledger(ledger)
    return {"status": "fetched", "region": region_key, **summary}


# ---------------------------------------------------------------------------
# Non-blocking fetch jobs
#
# A full region fetch (SIA query + up to 8 cutout downloads) can take minutes,
# far longer than HTTP proxies keep a request open (the Next.js dev proxy cuts
# the socket after ~30 s, which surfaced as ECONNRESET / "Internal Server
# Error" in the frontend). The API therefore starts the fetch on a worker
# thread and answers immediately; clients poll the same endpoint until the
# status becomes "already_fetched" or "failed".
# ---------------------------------------------------------------------------

_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _run_fetch(ra_snap: float, dec_snap: float, region_key: str) -> None:
    try:
        fetch_region(ra_snap, dec_snap)
    except Exception as error:  # noqa: BLE001 - job outcome is reported via polling
        with _jobs_lock:
            _jobs[region_key] = {"status": "failed", "error": str(error)}
    else:
        with _jobs_lock:
            _jobs.pop(region_key, None)


def start_fetch(ra: float, dec: float) -> dict[str, Any]:
    """Start (or report on) a background fetch of this region.

    Returns one of:
    - ``{"status": "already_fetched", ...summary}`` — cutouts are in the cache.
    - ``{"status": "fetching", ...}`` — a download job is running; poll again.
    - ``{"status": "failed", "message": ...}`` — the last job failed; the next
      call starts a fresh attempt.
    """
    ra_snap, dec_snap = _snap(ra % 360.0), _snap(dec)
    region_key = f"{ra_snap},{dec_snap}"
    known = _read_ledger()["regions"].get(region_key)
    if known:
        with _jobs_lock:
            _jobs.pop(region_key, None)
        return {"status": "already_fetched", "region": region_key, **known}
    with _jobs_lock:
        job = _jobs.get(region_key)
        if job is not None:
            if job["status"] == "fetching":
                return {
                    "status": "fetching",
                    "region": region_key,
                    "message": "Querying IRSA and downloading cutouts; poll this endpoint for progress.",
                }
            # A finished-but-failed job: report it once, then forget it so the
            # caller's next request retries from scratch.
            _jobs.pop(region_key, None)
            return {
                "status": "failed",
                "region": region_key,
                "message": job.get("error") or "The live archive fetch failed. Try again shortly.",
            }
        _jobs[region_key] = {"status": "fetching"}
    threading.Thread(
        target=_run_fetch,
        args=(ra_snap, dec_snap, region_key),
        name=f"live-fetch-{region_key}",
        daemon=True,
    ).start()
    return {
        "status": "fetching",
        "region": region_key,
        "message": "Fetch started; poll this endpoint until the status is already_fetched.",
    }
