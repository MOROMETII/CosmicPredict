"""Thin Supabase REST (PostgREST) and Storage client.

Uses only the standard library so the backend and scraper need no extra
dependency. All operations raise :class:`SupabaseError` on failure so callers
can fall back to the local filesystem cache.
"""

from __future__ import annotations

import base64
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from backend import config

_USER_AGENT = "cosmic-predict-supabase/0.1"

# Supabase's standard upload endpoint rejects objects larger than ~50 MB; use
# the TUS resumable endpoint above that threshold.
_STANDARD_UPLOAD_LIMIT = 50 * 1024 * 1024
_TUS_CHUNK_SIZE = 6 * 1024 * 1024


class SupabaseError(RuntimeError):
    """Raised when a Supabase request fails or is misconfigured."""


class SupabaseClient:
    """Minimal Supabase REST + Storage client."""

    def __init__(self, url: str | None, service_role_key: str | None, bucket: str) -> None:
        self.url = (url or "").rstrip("/")
        self.key = service_role_key or ""
        self.bucket = bucket

    @property
    def available(self) -> bool:
        return config.supabase_configured()

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "User-Agent": _USER_AGENT,
        }
        if extra:
            headers.update(extra)
        return headers

    def _request(
        self,
        path: str,
        *,
        method: str = "GET",
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
    ) -> bytes:
        if not self.available:
            raise SupabaseError("Supabase is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)")
        request = urllib.request.Request(
            self.url + path,
            data=data,
            method=method,
            headers=self._headers(headers),
        )
        try:
            with urllib.request.urlopen(
                request, timeout=timeout, context=ssl.create_default_context()
            ) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            detail = error.read()[:300].decode("utf-8", errors="replace")
            raise SupabaseError(f"HTTP {error.code} from Supabase: {detail}") from error
        except urllib.error.URLError as error:
            raise SupabaseError(f"Supabase connection error: {error}") from error

    # --- PostgREST (table rows) ---

    def list_observations(self) -> list[dict[str, Any]]:
        path = "/rest/v1/observations?select=*&order=observation_id.asc"
        payload = json.loads(self._request(path, headers={"Accept": "application/json"}))
        return payload if isinstance(payload, list) else []

    def get_observation(self, observation_id: str) -> dict[str, Any] | None:
        encoded = urllib.parse.quote(observation_id, safe="")
        path = f"/rest/v1/observations?observation_id=eq.{encoded}&select=*&limit=1"
        payload = json.loads(self._request(path, headers={"Accept": "application/json"}))
        if isinstance(payload, list) and payload:
            return payload[0]
        return None

    def upsert_observation(self, record: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(record).encode("utf-8")
        payload = self._request(
            "/rest/v1/observations?on_conflict=observation_id",
            method="POST",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
        )
        rows = json.loads(payload)
        return rows[0] if isinstance(rows, list) and rows else {}

    # --- Storage (file objects) ---

    def _tus_upload(self, object_path: str, data: bytes, content_type: str) -> None:
        """Upload via the TUS resumable endpoint (for files over ~50 MB)."""

        def b64(value: str) -> str:
            return base64.b64encode(value.encode("utf-8")).decode("ascii")

        metadata = (
            f"bucketName {b64(self.bucket)},"
            f"objectName {b64(object_path)},"
            f"contentType {b64(content_type)}"
        )
        create_request = urllib.request.Request(
            self.url + "/storage/v1/upload/resumable",
            method="POST",
            headers=self._headers(
                {
                    "x-upsert": "true",
                    "Tus-Resumable": "1.0.0",
                    "Upload-Length": str(len(data)),
                    "Upload-Metadata": metadata,
                }
            ),
        )
        try:
            with urllib.request.urlopen(
                create_request, timeout=60.0, context=ssl.create_default_context()
            ) as response:
                location = response.headers.get("Location")
        except (urllib.error.HTTPError, urllib.error.URLError) as error:
            raise SupabaseError(f"resumable upload create failed: {error}") from error

        if not location:
            raise SupabaseError("resumable upload create returned no Location header")
        if not location.startswith("http"):
            location = self.url + location

        offset = 0
        while offset < len(data):
            chunk = data[offset : offset + _TUS_CHUNK_SIZE]
            patch_request = urllib.request.Request(
                location,
                data=chunk,
                method="PATCH",
                headers=self._headers(
                    {
                        "Tus-Resumable": "1.0.0",
                        "Content-Type": "application/offset+octet-stream",
                        "Upload-Offset": str(offset),
                    }
                ),
            )
            try:
                with urllib.request.urlopen(
                    patch_request, timeout=120.0, context=ssl.create_default_context()
                ):
                    pass
            except (urllib.error.HTTPError, urllib.error.URLError) as error:
                raise SupabaseError(f"resumable upload chunk failed at offset {offset}: {error}") from error
            offset += len(chunk)

    def upload_object(self, object_path: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        if len(data) > _STANDARD_UPLOAD_LIMIT:
            self._tus_upload(object_path, data, content_type)
            return
        encoded = urllib.parse.quote(object_path, safe="/")
        self._request(
            f"/storage/v1/object/{self.bucket}/{encoded}",
            method="POST",
            data=data,
            headers={
                "Content-Type": content_type,
                "x-upsert": "true",
                "cache-control": "max-age=31536000",
            },
        )

    def download_object(self, object_path: str) -> bytes:
        encoded = urllib.parse.quote(object_path, safe="/")
        return self._request(f"/storage/v1/object/{self.bucket}/{encoded}")
