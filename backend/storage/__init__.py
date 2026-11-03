"""Unified observation storage: Supabase-first with local filesystem fallback.

The backend reads observation metadata and image bytes from Supabase when it is
configured, and transparently falls back to the local ``data/raw`` cache when
Supabase is unreachable. Downloaded assets are written back to the local cache
so the local directory also acts as a backup.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from backend import config
from backend.astronomy import compact
from backend.astronomy.fits_loader import FitsObservation, load_fits_observation
from backend.storage import local
from backend.storage.supabase import SupabaseClient, SupabaseError

_client = SupabaseClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, config.SUPABASE_BUCKET)

# Column names exposed by the ``observations`` table (see supabase/migrations).
_DB_COLUMNS = (
    "observation_id",
    "source_url",
    "query_url",
    "retrieved_at",
    "epoch",
    "band",
    "ra",
    "dec",
    "header",
    "local_path",
    "storage_path",
    "preview_storage_path",
    "asset_status",
    "source",
)


def is_supabase_available() -> bool:
    return _client.available


def list_observations() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if _client.available:
        try:
            records = list(_client.list_observations())
        except SupabaseError as error:
            print(f"Supabase unavailable, using local cache: {error}", file=sys.stderr)
    # Always merge in any local observations not yet persisted to Supabase, so
    # the catalog is the union of both stores and never hides local backups.
    seen = {record["observation_id"] for record in records}
    for record in local.list_observations():
        if record["observation_id"] not in seen:
            records.append(record)
            seen.add(record["observation_id"])
    records.sort(key=lambda record: record["observation_id"])
    return records


def get_observation(observation_id: str) -> dict[str, Any] | None:
    if _client.available:
        try:
            record = _client.get_observation(observation_id)
            if record is not None:
                return record
        except SupabaseError as error:
            print(f"Supabase unavailable, using local cache: {error}", file=sys.stderr)
    return local.get_observation(observation_id)


def load_observation(observation_id: str) -> FitsObservation:
    """Load an observation's science image + mask, Supabase-first.

    Downloads the compact ``.npz`` snapshot from Supabase Storage when present,
    caching it locally as a backup, and otherwise falls back to the local raw
    FITS file.
    """
    record = get_observation(observation_id)
    if record is None:
        raise FileNotFoundError(f"unknown observation: {observation_id}")

    storage_path = record.get("storage_path")
    if _client.available and isinstance(storage_path, str) and storage_path.endswith(".npz"):
        snapshot_path = config.SNAPSHOT_DIR / Path(storage_path).name
        if not snapshot_path.is_file():
            snapshot_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                snapshot_path.write_bytes(_client.download_object(storage_path))
            except SupabaseError as error:
                print(f"Supabase snapshot download failed for {observation_id}, using local FITS: {error}", file=sys.stderr)
            else:
                return compact.observation_from_bytes(
                    snapshot_path.read_bytes(),
                    header=record.get("header") or {},
                    path=snapshot_path,
                )

    local_fits = config.RAW_DIR / (record.get("local_path") or f"{observation_id}.fits")
    return load_fits_observation(local_fits)


def save_observation_metadata(record: dict[str, Any]) -> dict[str, Any]:
    """Persist only the observation metadata row (no file upload).

    Useful when the raw FITS exceeds Supabase's upload size limit; the FITS
    stays in the local cache and the table drives the catalog.
    """
    if not _client.available:
        return record
    db_record = {column: record.get(column) for column in _DB_COLUMNS}
    try:
        _client.upsert_observation(db_record)
    except SupabaseError as error:
        print(f"Supabase metadata save failed for {record.get('observation_id')}: {error}", file=sys.stderr)
        return record
    return record


def upload_observation(
    record: dict[str, Any],
    *,
    snapshot_bytes: bytes,
    snapshot_name: str,
) -> dict[str, Any]:
    """Persist a compact snapshot (science image + mask) to Supabase Storage.

    The snapshot bytes are uploaded to the ``spherex-images`` bucket and the
    object key is stored on the metadata row, so the backend loads the image
    data from Supabase. The raw FITS stays in the local cache as backup.
    """
    if not _client.available:
        return record

    snapshot_key = f"parsed/{snapshot_name}"
    try:
        _client.upload_object(snapshot_key, snapshot_bytes, "application/octet-stream")
        db_record = {column: record.get(column) for column in _DB_COLUMNS}
        db_record["storage_path"] = snapshot_key
        _client.upsert_observation(db_record)
    except SupabaseError as error:
        print(f"Supabase upload failed for {record.get('observation_id')}: {error}", file=sys.stderr)
        record["_uploaded"] = False
        return record

    record["storage_path"] = snapshot_key
    record["_uploaded"] = True
    return record
