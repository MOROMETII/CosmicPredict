"""Download a time-spread sample of SPHEREx observations for the challenge targets.

The Space Apps challenge asks the tool to display "a series of images of that
patch like a little video" and names five test targets. A naive SIA query
returns hundreds of ~65 MB FITS files per target, most from the same week, so
this script samples instead: for each target it queries IRSA (``spherex_dr1``
for the long multi-epoch baseline plus ``spherex_qr3`` for the newest data),
picks the detector band with the best month coverage, and downloads at most one
well-centered image per calendar month.

Files land in ``data/raw`` with a provenance manifest, where the backend's
local provider picks them up automatically. Pass ``--upload`` to also push
compact snapshots + metadata to Supabase for the rest of the team.

Example:
    python scripts/scrape_timeline.py --dry-run
    python scripts/scrape_timeline.py --targets "Barnard's Star" --upload
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(REPO_ROOT))

import download_data  # noqa: E402
from backend.astronomy import compact  # noqa: E402
from backend.astronomy.fits_loader import load_fits_observation  # noqa: E402
from backend.storage import upload_observation  # noqa: E402

COLLECTIONS = ("spherex_dr1", "spherex_qr3")
SIA_BASE = "https://irsa.ipac.caltech.edu/SIA?COLLECTION={collection}"

# (name, ra_deg, dec_deg, preferred band prefixes or None for automatic).
# WISE 0855 is a ~250 K brown dwarf: essentially invisible below ~3 um, so
# only the long-wavelength detectors (D5/D6, 3.8-5.0 um) can show it.
TARGETS: list[tuple[str, float, float, tuple[str, ...] | None]] = [
    ("Barnard's Star", 269.454, 4.693, None),
    ("Epsilon Indi", 330.840, -56.786, None),
    ("WISE 0855", 133.795, -7.245, ("SPHEREx-D6", "SPHEREx-D5")),
    ("RW Aurigae", 76.957, 30.401, None),
    ("R Draconis", 248.168, 66.755, None),
]


def _mjd_to_iso(mjd: float) -> str:
    seconds = (float(mjd) - 40587.0) * 86400.0
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def _separation_deg(ra_a: float, dec_a: float, ra_b: float, dec_b: float) -> float:
    ra_a, dec_a, ra_b, dec_b = map(np.deg2rad, (ra_a, dec_a, ra_b, dec_b))
    cosine = np.sin(dec_a) * np.sin(dec_b) + np.cos(dec_a) * np.cos(dec_b) * np.cos(ra_a - ra_b)
    return float(np.rad2deg(np.arccos(np.clip(cosine, -1.0, 1.0))))


def _query_target(ra: float, dec: float, *, radius: float, timeout: float) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for collection in COLLECTIONS:
        url = download_data.build_query_url(
            SIA_BASE.format(collection=collection),
            ra=ra,
            dec=dec,
            size=radius * 2.0,
            band=None,
            start_time=None,
            end_time=None,
            max_records=3000,
        )
        try:
            found = download_data.fetch_votable(url, timeout=timeout)
        except Exception as error:  # noqa: BLE001 - one collection failing should not kill the run
            print(f"  query failed for {collection}: {error}", file=sys.stderr)
            continue
        for record in found:
            record["_query_url"] = url
        records.extend(found)
    return records


def _usable(record: dict[str, Any]) -> bool:
    return (
        record.get("dataproduct_type") == "image"
        and isinstance(record.get("access_url"), str)
        and record.get("t_min") is not None
        and record.get("energy_bandpassname")
    )


def select_frames(
    records: list[dict[str, Any]],
    *,
    ra: float,
    dec: float,
    preferred_bands: tuple[str, ...] | None,
    max_frames: int,
) -> list[dict[str, Any]]:
    """Choose at most one well-centered record per calendar month, one band."""

    by_band: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for record in records:
        if not _usable(record):
            continue
        band = str(record["energy_bandpassname"])
        month = _mjd_to_iso(record["t_min"])[:7]
        by_band.setdefault(band, {}).setdefault(month, []).append(record)

    if not by_band:
        return []

    def band_rank(band: str) -> tuple[int, int, int]:
        months = by_band[band]
        preferred = 1 if preferred_bands and band in preferred_bands else 0
        return (preferred, len(months), sum(len(v) for v in months.values()))

    band = max(by_band, key=band_rank)
    # If a preferred band exists but has coverage in fewer than 2 months, it
    # cannot support a time series; fall back to the automatic choice.
    if preferred_bands and band in preferred_bands and len(by_band[band]) < 2:
        fallback = max(by_band, key=lambda b: (len(by_band[b]),))
        if len(by_band[fallback]) > len(by_band[band]):
            band = fallback

    frames = []
    for month in sorted(by_band[band]):
        candidates = by_band[band][month]
        best = min(
            candidates,
            key=lambda r: _separation_deg(ra, dec, float(r["s_ra"]), float(r["s_dec"])),
        )
        frames.append(best)
    # Keep the sequence bounded but spread: trim from the densest months last.
    if len(frames) > max_frames:
        step = len(frames) / max_frames
        frames = [frames[int(i * step)] for i in range(max_frames)]
    return frames


def download_and_register(
    frames: list[dict[str, Any]],
    *,
    target_name: str,
    raw_dir: Path,
    delay: float,
    timeout: float,
    upload: bool,
) -> list[dict[str, Any]]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    for index, record in enumerate(frames):
        data_url = str(record["access_url"])
        filename = download_data._safe_filename(data_url, index)  # noqa: SLF001 - sibling script helper
        destination = raw_dir / filename
        if destination.exists():
            print(f"  already cached: {filename}")
        else:
            print(f"  downloading {data_url}")
            try:
                download_data.download_file(data_url, destination, timeout=timeout)
            except Exception as error:  # noqa: BLE001 - keep going across frames
                print(f"  download failed: {error}", file=sys.stderr)
                continue
            if delay > 0:
                time.sleep(delay)

        try:
            observation = load_fits_observation(destination)
        except (OSError, ValueError, TypeError) as error:
            print(f"  unreadable FITS {filename}: {error}", file=sys.stderr)
            continue

        header = observation.header
        detector = header.get("DETECTOR")
        row: dict[str, Any] = {
            "observation_id": destination.stem,
            "source_url": data_url,
            "query_url": record.get("_query_url"),
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "epoch": header.get("DATE-OBS"),
            "band": str(detector) if detector is not None else str(record.get("energy_bandpassname")),
            "ra": header.get("CRVAL1"),
            "dec": header.get("CRVAL2"),
            "header": header,
            "local_path": filename,
            "storage_path": None,
            "preview_storage_path": None,
            "asset_status": "preview_available",
            "source": "scraper",
        }
        if upload:
            row = upload_observation(
                row,
                snapshot_bytes=compact.observation_to_bytes(observation),
                snapshot_name=f"{destination.stem}.npz",
            )
        results.append(
            {
                "target": target_name,
                "archive_record": {k: v for k, v in record.items() if not k.startswith("_")},
                **{k: v for k, v in row.items() if k != "header"},
            }
        )
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", nargs="*", help="subset of target names (default: all)")
    parser.add_argument("--radius", type=float, default=0.05, help="query radius in degrees")
    parser.add_argument("--max-frames", type=int, default=14, help="max images per target")
    parser.add_argument("--delay", type=float, default=3.0, help="seconds between downloads")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--raw-output", type=Path, default=Path("data/raw"))
    parser.add_argument("--upload", action="store_true", help="also push snapshots + metadata to Supabase")
    parser.add_argument("--dry-run", action="store_true", help="show the selection plan without downloading")
    args = parser.parse_args(argv)

    chosen = [t for t in TARGETS if not args.targets or t[0] in args.targets]
    if not chosen:
        print(f"no targets match {args.targets}; known: {[t[0] for t in TARGETS]}", file=sys.stderr)
        return 2

    manifest: list[dict[str, Any]] = []
    for name, ra, dec, preferred in chosen:
        print(f"=== {name} (RA={ra}, Dec={dec}) ===")
        records = _query_target(ra, dec, radius=args.radius, timeout=args.timeout)
        frames = select_frames(records, ra=ra, dec=dec, preferred_bands=preferred, max_frames=args.max_frames)
        if not frames:
            print("  no usable archive records found", file=sys.stderr)
            continue
        band = frames[0]["energy_bandpassname"]
        months = [_mjd_to_iso(f["t_min"])[:7] for f in frames]
        size_mb = sum(int(f.get("access_estsize") or 0) for f in frames) / 1024.0
        print(f"  plan: {len(frames)} frames, band {band}, months {months}, ~{size_mb:.0f} MB")
        if args.dry_run:
            continue
        manifest.extend(
            download_and_register(
                frames,
                target_name=name,
                raw_dir=args.raw_output,
                delay=args.delay,
                timeout=args.timeout,
                upload=args.upload,
            )
        )

    if not args.dry_run:
        manifest_path = args.raw_output / "timeline_manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "format": "cosmic-predict-timeline-v1",
                    "collections": list(COLLECTIONS),
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                    "records": manifest,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"wrote {manifest_path} ({len(manifest)} observations)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
