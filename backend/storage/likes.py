"""User likes on sky-region reels — the heart button / double-tap.

A like is a lightweight "this is cool" signal. Likes carry no scientific weight;
they only drive the engagement leaderboard. Stored as JSON on the filesystem
(``data/likes.json``), behind a process-wide lock.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend import config

_FILE_NAME = "likes.json"
_lock = threading.Lock()

MAX_LIKES = 10000


def _path() -> Path:
    return config.RAW_DIR.parent / _FILE_NAME


def _read() -> list[dict[str, Any]]:
    path = _path()
    if path.is_file():
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(document, dict) and isinstance(document.get("likes"), list):
                return document["likes"]
        except (OSError, ValueError):
            pass
    return []


def _write(likes: list[dict[str, Any]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"likes": likes}, indent=1), encoding="utf-8")


def list_likes() -> list[dict[str, Any]]:
    with _lock:
        likes = _read()
    return list(likes)


def count_likes(region_key: str) -> int:
    with _lock:
        likes = _read()
    return sum(1 for like in likes if like.get("region_key") == region_key)


def add_like(region_key: str) -> dict[str, Any]:
    like = {
        "id": uuid.uuid4().hex[:12],
        "region_key": region_key,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        likes = _read()
        likes.append(like)
        if len(likes) > MAX_LIKES:
            likes = likes[-MAX_LIKES:]
        _write(likes)
    return like
