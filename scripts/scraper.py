"""Scrape, download, parse, and upload SPHEREx images from IRSA SIA v2.

Reuses the archive query/download helpers in ``download_data.py`` and the FITS
parsing in ``backend.astronomy``. Each image returned by the query is
downloaded to ``--raw-output``, parsed (loaded + robustly normalized) into a
``.npz`` under ``--parsed-output``, and pushed to Supabase when configured.
The local files are always kept as a backup if Supabase is unreachable.

Example:
    python scripts/scraper.py --ra 83.8 --dec -5.4 --size 0.5 \
        --service-url "https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2" \
        --max-records 5 --delay 5
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

# Support `python scripts/scraper.py` from the repository root and let the
# scraper import its sibling downloader and the backend astronomy modules.
SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(REPO_ROOT))

import download_data  # noqa: E402
from backend.astronomy import compact  # noqa: E402
from backend.astronomy.calibration import robust_normalize  # noqa: E402
from backend.astronomy.fits_loader import load_fits_observation  # noqa: E402
from backend.storage import upload_observation  # noqa: E402

DEFAULT_SERVICE_URL = "https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2"


def _iso_epoch(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if "+" not in text and text.count(":") >= 2:
        text += "+00:00"
    return text


def parse_image(raw_path: Path, parsed_dir: Path, index: int) -> tuple[dict[str, Any], Any]:
    """Parse one downloaded FITS file into a normalized, masked ``.npz``."""

    observation = load_fits_observation(raw_path)
    calibrated = robust_normalize(observation)
    parsed_path = parsed_dir / f"observation_{index:03d}_parsed.npz"
    np.savez_compressed(
        parsed_path,
        image=calibrated.image,
        valid_mask=calibrated.valid_mask,
    )
    return {
        "parsed_path": parsed_path.name,
        "raw_path": raw_path.name,
        "shape": list(observation.shape),
        "normalization": {
            "lower": calibrated.lower,
            "upper": calibrated.upper,
            "fill_value": calibrated.fill_value,
        },
        "provenance": observation.header,
    }, observation


def scrape(
    *,
    service_url: str,
    raw_dir: Path,
    parsed_dir: Path,
    ra: float,
    dec: float,
    size: float,
    band: str | None,
    start_time: str | None,
    end_time: str | None,
    max_records: int,
    timeout: float,
    delay: float,
    strict: bool,
) -> Path:
    """Download SPHEREx images from IRSA SIA, parse, and upload each to Supabase."""

    parsed_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = download_data.download_sample(
        service_url=service_url,
        output_dir=raw_dir,
        ra=ra,
        dec=dec,
        size=size,
        band=band,
        start_time=start_time,
        end_time=end_time,
        max_records=max_records,
        timeout=timeout,
        delay=delay,
    )

    raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    parsed_records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for index, item in enumerate(raw_manifest.get("records", [])):
        filename = item.get("local_path")
        if not filename:
            continue
        raw_path = raw_dir / filename
        try:
            parsed, observation = parse_image(raw_path, parsed_dir, index)
        except (OSError, ValueError, TypeError) as error:
            error_record = {"source_path": str(raw_path), "error": str(error)}
            errors.append(error_record)
            print(f"skipping {raw_path}: {error}", file=sys.stderr)
            if strict:
                raise
            continue

        header = parsed["provenance"]
        detector = header.get("DETECTOR")
        record: dict[str, Any] = {
            "observation_id": Path(filename).stem,
            "source_url": item.get("source_url"),
            "query_url": item.get("query_url"),
            "retrieved_at": item.get("retrieved_at"),
            "epoch": _iso_epoch(header.get("DATE-OBS")),
            "band": str(detector) if detector is not None else band,
            "wavelength": header.get("WAVELENGTH"),
            "ra": header.get("CRVAL1"),
            "dec": header.get("CRVAL2"),
            "header": header,
            "local_path": filename,
            "storage_path": None,
            "preview_storage_path": None,
            "asset_status": "preview_available",
            "source": "scraper",
        }
        try:
            record = upload_observation(
                record,
                snapshot_bytes=compact.observation_to_bytes(observation),
                snapshot_name=f"{Path(filename).stem}.npz",
            )
        except OSError as error:
            print(f"could not read local asset for {filename}: {error}", file=sys.stderr)

        parsed_records.append({**item, **parsed, **record})

    parsed_manifest_path = parsed_dir / "manifest.json"
    parsed_manifest_path.write_text(
        json.dumps(
            {
                "format": "cosmic-predict-scraped-v1",
                "query": raw_manifest.get("query"),
                "provider": raw_manifest.get("provider"),
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "records": parsed_records,
                "errors": errors,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return parsed_manifest_path


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service-url",
        default=os.environ.get("SPHEREX_SIA_URL") or DEFAULT_SERVICE_URL,
    )
    parser.add_argument("--ra", type=float, required=True)
    parser.add_argument("--dec", type=float, required=True)
    parser.add_argument("--size", type=float, default=0.5, help="region size in degrees (used as circle diameter)")
    parser.add_argument("--band", help="archive-specific wavelength or band constraint")
    parser.add_argument("--start-time")
    parser.add_argument("--end-time")
    parser.add_argument("--max-records", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--delay", type=float, default=0.0, help="seconds to sleep between downloads (rate-limit guard)")
    parser.add_argument("--raw-output", type=Path, default=Path("data/raw"))
    parser.add_argument("--parsed-output", type=Path, default=Path("data/parsed"))
    parser.add_argument("--strict", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        manifest_path = scrape(
            service_url=args.service_url,
            raw_dir=args.raw_output,
            parsed_dir=args.parsed_output,
            ra=args.ra,
            dec=args.dec,
            size=args.size,
            band=args.band,
            start_time=args.start_time,
            end_time=args.end_time,
            max_records=args.max_records,
            timeout=args.timeout,
            delay=args.delay,
            strict=args.strict,
        )
    except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError) as error:
        print(f"scrape failed: {error}", file=sys.stderr)
        return 1
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    print(f"scraped {len(payload['records'])} image(s) into {manifest_path}")
    if payload["errors"]:
        print(f"skipped {len(payload['errors'])} unparseable FITS file(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
