"""Backend configuration loaded from ``backend/.env`` (or the repo-root ``.env``).

This is a dependency-free dotenv loader so the FastAPI app and the scraping
scripts read the same settings without pulling in an extra package. Values in
``os.environ`` (e.g. GitHub Actions secrets) always take precedence.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
            value = value[1:-1]
        os.environ.setdefault(key, value)


for _candidate in (BACKEND_DIR / ".env", REPO_ROOT / ".env"):
    _load_dotenv(_candidate)


def getenv(key: str, default: str | None = None) -> str | None:
    value = os.environ.get(key)
    if value is None:
        return default
    return value


SUPABASE_URL: str | None = getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY: str | None = getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_BUCKET: str = getenv("SUPABASE_BUCKET", "spherex-images") or "spherex-images"
SPHEREX_SIA_URL: str | None = getenv("SPHEREX_SIA_URL")
JEPA_CHECKPOINT: Path = Path(getenv("JEPA_CHECKPOINT", "models/checkpoints/jepa.pt") or "models/checkpoints/jepa.pt")
RAW_DIR: Path = Path(getenv("DATA_RAW_DIR", "data/raw") or "data/raw")
SNAPSHOT_DIR: Path = Path(getenv("DATA_SNAPSHOT_DIR", "data/snapshots") or "data/snapshots")
if not RAW_DIR.is_absolute():
    RAW_DIR = REPO_ROOT / RAW_DIR
if not JEPA_CHECKPOINT.is_absolute():
    JEPA_CHECKPOINT = REPO_ROOT / JEPA_CHECKPOINT
if not SNAPSHOT_DIR.is_absolute():
    SNAPSHOT_DIR = REPO_ROOT / SNAPSHOT_DIR


def supabase_configured() -> bool:
    placeholders = ("YOUR_PROJECT", "YOUR_PROJECT_REF", "your-service-role-key", "changeme", "example")
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False
    if any(token in SUPABASE_URL for token in placeholders):
        return False
    if any(token in SUPABASE_SERVICE_ROLE_KEY for token in placeholders):
        return False
    return True
