"""User saves (likes) on sky-region reels — the double-tap heart.

A save is a lightweight "this is cool, come back to it" signal, distinct from a
flag (a "this looks suspicious" bookmark for scientific review). Saves carry no
scientific weight; they only contribute to the social engagement score.

Stored as JSON on the filesystem (``data/saves.json``), behind a process-wide
lock, mirroring the marks/comments stores.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend import config

_FILE_NAME = "saves.json"
_lock = threading.Lock()

MAX_SAVES = 10000


def _path() -> Path:
    return config.RAW_DIR.parent / _FILE_NAME


def _read() -> list[dict[str, Any]]:
    path = _path()
    if path.is_file():
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(document, dict) and isinstance(document.get("saves"), list):
                return document["saves"]
        except (OSError, ValueError):
            pass
    return []


def _write(saves: list[dict[str, Any]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"saves": saves}, indent=1), encoding="utf-8")


def list_saves() -> list[dict[str, Any]]:
    with _lock:
        saves = _read()
    return list(saves)


def count_saves(region_key: str) -> int:
    with _lock:
        saves = _read()
    return sum(1 for save in saves if save.get("region_key") == region_key)


def add_save(region_key: str) -> dict[str, Any]:
    save = {
        "id": uuid.uuid4().hex[:12],
        "region_key": region_key,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        saves = _read()
        saves.append(save)
        if len(saves) > MAX_SAVES:
            saves = saves[-MAX_SAVES:]
        _write(saves)
    return save
