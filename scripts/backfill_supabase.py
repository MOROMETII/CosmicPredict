"""Upload already-scraped local FITS observations to Supabase.

Each observation is stored as a compact ``.npz`` snapshot (science image +
validity mask, ~14 MB) plus a metadata row, so the backend can load the image
data from Supabase. The raw FITS stays in the local cache as a backup.

Idempotent: rows are upserted by ``observation_id`` and objects overwritten.

Example:
    python scripts/backfill_supabase.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend import config  # noqa: E402
from backend.astronomy import compact  # noqa: E402
from backend.astronomy.fits_loader import load_fits_observation  # noqa: E402
from backend.storage import is_supabase_available, local, save_observation_metadata, upload_observation  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0, help="max records to upload (0 = all)")
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="only upsert the metadata rows, skip uploading image snapshots",
    )
    args = parser.parse_args(argv)

    if not is_supabase_available():
        print("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
        return 2

    records = local.list_observations()
    if not records:
        print(f"no local observations found in {config.RAW_DIR}")
        return 1

    uploaded = 0
    failed = 0
    processed = 0
    for record in records:
        if args.limit and processed >= args.limit:
            break
        processed += 1
        raw_path = config.RAW_DIR / record["local_path"]

        if args.metadata_only:
            save_observation_metadata(record)
            uploaded += 1
            print(f"metadata {record['observation_id']}")
            continue

        if not raw_path.is_file():
            print(f"skipping missing file {raw_path}", file=sys.stderr)
            failed += 1
            continue
        try:
            observation = load_fits_observation(raw_path)
            updated = upload_observation(
                record,
                snapshot_bytes=compact.observation_to_bytes(observation),
                snapshot_name=f"{record['observation_id']}.npz",
            )
        except (OSError, ValueError, TypeError) as error:
            print(f"failed to parse {raw_path}: {error}", file=sys.stderr)
            failed += 1
            continue
        if updated.get("_uploaded"):
            uploaded += 1
            print(f"uploaded {record['observation_id']}")
        else:
            failed += 1

    mode = "metadata" if args.metadata_only else "snapshots"
    print(f"done: {uploaded} uploaded ({mode}), {failed} failed, {len(records)} total local observations")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
