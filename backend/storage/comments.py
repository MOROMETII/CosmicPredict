"""User comments on sky regions (the Sky Scroll reels).

A comment is free-form user discussion attached to a specific sky region
(``region_key`` = snapped "ra,dec"). Unlike flags, comments carry no scientific
weight — they are social annotations, never detections or classifications.

Stored as JSON on the filesystem (``data/comments.json``), matching the
project's SQLite-or-JSON metadata rule, behind a process-wide lock.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend import config

_FILE_NAME = "comments.json"
_lock = threading.Lock()

MAX_PER_REGION = 500
MAX_BODY_LENGTH = 2000


def _path() -> Path:
    return config.RAW_DIR.parent / _FILE_NAME


def _read() -> dict[str, list[dict[str, Any]]]:
    path = _path()
    if path.is_file():
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(document, dict) and isinstance(document.get("regions"), dict):
                return document["regions"]
        except (OSError, ValueError):
            pass
    return {}


def _write(regions: dict[str, list[dict[str, Any]]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"regions": regions}, indent=1), encoding="utf-8")


def list_comments(region_key: str) -> list[dict[str, Any]]:
    with _lock:
        regions = _read()
    comments = regions.get(region_key, [])
    return sorted(comments, key=lambda comment: comment.get("created_at") or "", reverse=False)


def list_comments_all() -> list[dict[str, Any]]:
    """Every comment across all regions (for scoring), in no particular order."""
    with _lock:
        regions = _read()
    flattened: list[dict[str, Any]] = []
    for comments in regions.values():
        flattened.extend(comments)
    return flattened


def add_comment(
    region_key: str,
    author: str | None,
    body: str,
    *,
    gif_url: str | None = None,
    gif_still_url: str | None = None,
    gif_title: str | None = None,
) -> dict[str, Any]:
    comment = {
        "id": uuid.uuid4().hex[:12],
        "region_key": region_key,
        "author": (author or "").strip() or "Anonymous",
        "body": body.strip(),
        "gif_url": gif_url,
        "gif_still_url": gif_still_url,
        "gif_title": gif_title,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        regions = _read()
        comments = regions.setdefault(region_key, [])
        comments.append(comment)
        # Bounded: oldest comments fall off rather than growing without limit.
        if len(comments) > MAX_PER_REGION:
            regions[region_key] = comments[-MAX_PER_REGION:]
        _write(regions)
    return comment
