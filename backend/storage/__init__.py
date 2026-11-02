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
    if _client.available:
        try:
            return _client.list_observations()
        except SupabaseError as error:
            print(f"Supabase unavailable, using local cache: {error}", file=sys.stderr)
    return local.list_observations()


def get_observation(observation_id: str) -> dict[str, Any] | None:
    if _client.available:
        try:
            record = _client.get_observation(observation_id)
            if record is not None:
                return record
        except SupabaseError as error:
            print(f"Supabase unavailable, using local cache: {error}", file=sys.stderr)
    return local.get_observation(observation_id)


def resolve_asset_path(observation_id: str) -> Path:
    """Return a local path to the FITS file, downloading from Supabase if needed.

    The local cache is written whenever the asset is fetched from Supabase so it
    serves as a backup if Supabase later becomes unreachable.
    """
    record = get_observation(observation_id)
    if record is None:
        raise FileNotFoundError(f"unknown observation: {observation_id}")

    local_path = record.get("local_path") or Path(record.get("storage_path") or f"{observation_id}.fits").name
    candidate = config.RAW_DIR / local_path
    if candidate.is_file():
        return candidate

    storage_path = record.get("storage_path")
    if _client.available and storage_path:
        candidate.parent.mkdir(parents=True, exist_ok=True)
        try:
            candidate.write_bytes(_client.download_object(storage_path))
        except SupabaseError as error:
            raise FileNotFoundError(f"asset unavailable for {observation_id}: {error}") from error
        return candidate

    raise FileNotFoundError(f"no local or remote asset for {observation_id}")


def upload_observation(
    record: dict[str, Any],
    *,
    raw_bytes: bytes,
    parsed_bytes: bytes | None = None,
    parsed_path: str | None = None,
) -> dict[str, Any]:
    """Persist a scraped observation to Supabase (Storage + table row).

    Returns the record updated with ``storage_path``/``preview_storage_path``.
    If Supabase is unavailable the record is returned unchanged so the local
    cache remains the backup source of truth.
    """
    if not _client.available:
        return record

    raw_key = f"raw/{record['local_path']}"
    parsed_key = f"parsed/{parsed_path}" if parsed_path else None
    try:
        _client.upload_object(raw_key, raw_bytes, "application/octet-stream")
        if parsed_key and parsed_bytes is not None:
            _client.upload_object(parsed_key, parsed_bytes, "application/octet-stream")
        db_record = {column: record.get(column) for column in _DB_COLUMNS}
        db_record["storage_path"] = raw_key
        db_record["preview_storage_path"] = parsed_key
        _client.upsert_observation(db_record)
    except SupabaseError as error:
        print(f"Supabase upload failed for {record.get('observation_id')}: {error}", file=sys.stderr)
        return record

    record["storage_path"] = raw_key
    record["preview_storage_path"] = parsed_key
    return record
