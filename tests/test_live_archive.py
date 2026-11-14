"""Tests for the live-archive retry logic and non-blocking fetch jobs."""

from __future__ import annotations

import time
import urllib.error

import pytest

from backend import config, http_util
from backend.storage import live_archive


@pytest.fixture(autouse=True)
def _isolated_state(monkeypatch, tmp_path):
    """Point the ledger at a temp dir and clear the in-process job registry."""
    monkeypatch.setattr(config, "RAW_DIR", tmp_path)
    with live_archive._jobs_lock:
        live_archive._jobs.clear()
    yield
    with live_archive._jobs_lock:
        live_archive._jobs.clear()


class _FakeResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_http_get_retries_transient_503(monkeypatch):
    attempts = []

    def fake_urlopen(request, timeout=None):
        attempts.append(request.full_url)
        if len(attempts) < 3:
            raise urllib.error.HTTPError(request.full_url, 503, "Service Unavailable", {}, None)
        return _FakeResponse(b"payload")

    monkeypatch.setattr(http_util.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(http_util.time, "sleep", lambda seconds: None)
    assert http_util.http_get("https://example.test/cutout", timeout=1.0) == b"payload"
    assert len(attempts) == 3


def test_http_get_does_not_retry_permanent_404(monkeypatch):
    attempts = []

    def fake_urlopen(request, timeout=None):
        attempts.append(request.full_url)
        raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(http_util.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(http_util.time, "sleep", lambda seconds: None)
    with pytest.raises(urllib.error.HTTPError):
        http_util.http_get("https://example.test/cutout", timeout=1.0)
    assert len(attempts) == 1


def _wait_for(predicate, timeout_seconds: float = 5.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition not met in time")


def test_start_fetch_runs_in_background_and_reports_success(monkeypatch):
    def fake_fetch_region(ra, dec, **kwargs):
        region_key = f"{live_archive._snap(ra)},{live_archive._snap(dec)}"
        with live_archive._ledger_lock:
            ledger = live_archive._read_ledger()
            ledger["regions"][region_key] = {"frames": 2, "files": ["a.fits", "b.fits"]}
            live_archive._write_ledger(ledger)
        return {"status": "fetched", "region": region_key}

    monkeypatch.setattr(live_archive, "fetch_region", fake_fetch_region)

    first = live_archive.start_fetch(10.0, -5.0)
    assert first["status"] == "fetching"

    # Poll like the frontend does until the job lands in the ledger.
    _wait_for(lambda: live_archive.start_fetch(10.0, -5.0)["status"] == "already_fetched")
    done = live_archive.start_fetch(10.0, -5.0)
    assert done["status"] == "already_fetched"
    assert done["frames"] == 2


def test_start_fetch_reports_failure_then_allows_retry(monkeypatch):
    def failing_fetch_region(ra, dec, **kwargs):
        raise live_archive.LiveArchiveError("archive said no")

    monkeypatch.setattr(live_archive, "fetch_region", failing_fetch_region)

    assert live_archive.start_fetch(20.0, 5.0)["status"] == "fetching"
    _wait_for(lambda: live_archive._jobs.get("20.0,5.0", {}).get("status") == "failed")

    failed = live_archive.start_fetch(20.0, 5.0)
    assert failed["status"] == "failed"
    assert "archive said no" in failed["message"]

    # The failed job is cleared, so the next request starts a fresh attempt.
    assert live_archive.start_fetch(20.0, 5.0)["status"] == "fetching"
