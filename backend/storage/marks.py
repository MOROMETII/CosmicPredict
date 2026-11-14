"""User anomaly flags: personal bookmarks on sky positions.

A mark is a user's "this looks suspicious, come back to it" annotation — a
view center, an optional tapped spot inside the frame, and an optional note.
Marks are user-generated bookmarks, never detections: they carry no scores
and imply no confirmation.

Stored as JSON on the filesystem (``data/marks.json``), matching the
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

_FILE_NAME = "marks.json"
_lock = threading.Lock()

MAX_MARKS = 1000


def _path() -> Path:
    return config.RAW_DIR.parent / _FILE_NAME


def _read() -> list[dict[str, Any]]:
    path = _path()
    if path.is_file():
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(document, dict) and isinstance(document.get("marks"), list):
                return document["marks"]
        except (OSError, ValueError):
            pass
    return []


def _write(marks: list[dict[str, Any]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"marks": marks}, indent=1), encoding="utf-8")


def list_marks() -> list[dict[str, Any]]:
    with _lock:
        marks = _read()
    return sorted(marks, key=lambda mark: mark.get("created_at") or "", reverse=True)


def add_mark(fields: dict[str, Any]) -> dict[str, Any]:
    mark = {
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    with _lock:
        marks = _read()
        marks.append(mark)
        # Bounded: oldest marks fall off rather than growing without limit.
        if len(marks) > MAX_MARKS:
            marks = marks[-MAX_MARKS:]
        _write(marks)
    return mark


def delete_mark(mark_id: str) -> bool:
    with _lock:
        marks = _read()
        remaining = [mark for mark in marks if mark.get("id") != mark_id]
        if len(remaining) == len(marks):
            return False
        _write(remaining)
    return True
