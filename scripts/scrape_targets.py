"""Scrape the featured science targets from IRSA SIA v2.

Barnard's Star is requested with a higher record count so we capture multiple
observation epochs (SPHEREx revisits the sky every ~6 months). Each run sleeps
between downloads to stay polite to the archive.

Example:
    python scripts/scrape_targets.py
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(REPO_ROOT))

import scraper  # noqa: E402

SERVICE_URL = "https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2"

# (name, ra_deg, dec_deg, max_records)
TARGETS = [
    ("Barnard's Star", 269.454, 4.693, 12),
    ("Epsilon Indi", 330.840, -56.786, 3),
    ("WISE 0855", 133.795, -7.245, 3),
    ("RW Aurigae", 76.957, 30.401, 3),
    ("R Draconis", 262.316, 66.000, 3),
]


def main() -> int:
    for name, ra, dec, max_records in TARGETS:
        print(f"=== {name}: RA={ra} Dec={dec} (max {max_records} records) ===")
        try:
            scraper.scrape(
                service_url=SERVICE_URL,
                raw_dir=Path("data/raw"),
                parsed_dir=Path("data/parsed"),
                ra=ra,
                dec=dec,
                size=0.5,
                band=None,
                start_time=None,
                end_time=None,
                max_records=max_records,
                timeout=90.0,
                delay=10.0,
                strict=False,
            )
        except Exception as error:  # noqa: BLE001 - keep going across targets
            print(f"target {name} failed: {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
