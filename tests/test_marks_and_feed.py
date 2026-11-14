"""Tests for the user-flag (marks) store and the scroll-feed API."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.main import app
from backend.storage import marks


@pytest.fixture(autouse=True)
def _isolated_data_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "RAW_DIR", tmp_path / "raw")


@pytest.fixture()
def client():
    return TestClient(app)


def test_mark_lifecycle_via_api(client):
    created = client.post(
        "/api/marks",
        json={
            "ra": 180.0,
            "dec": 0.0,
            "fov_arcmin": 15.0,
            "note": "  dot moved between frames  ",
            "x_frac": 0.5,
            "y_frac": 0.5,
            "source": "scroll",
        },
    )
    assert created.status_code == 200
    mark = created.json()
    assert mark["note"] == "dot moved between frames"
    # The tapped frame center converts to the view-center sky position.
    assert mark["spot_ra"] == pytest.approx(180.0, abs=1e-4)
    assert mark["spot_dec"] == pytest.approx(0.0, abs=1e-4)
    assert "not a detection" in mark["caveat"]

    listed = client.get("/api/marks").json()
    assert listed["status"] == "ok"
    assert [m["id"] for m in listed["marks"]] == [mark["id"]]

    assert client.delete(f"/api/marks/{mark['id']}").status_code == 200
    assert client.get("/api/marks").json()["marks"] == []
    assert client.delete(f"/api/marks/{mark['id']}").status_code == 404


def test_mark_spot_respects_grid_orientation(client):
    # Tapping the top of the frame (y_frac=0) must mark a spot NORTH of center.
    mark = client.post(
        "/api/marks",
        json={"ra": 180.0, "dec": 0.0, "fov_arcmin": 15.0, "x_frac": 0.5, "y_frac": 0.0},
    ).json()
    assert mark["spot_dec"] > 0.0


def test_marks_store_is_bounded(monkeypatch):
    monkeypatch.setattr(marks, "MAX_MARKS", 5)
    for index in range(8):
        marks.add_mark({"ra": float(index), "dec": 0.0, "fov_arcmin": 10.0})
    stored = marks.list_marks()
    assert len(stored) == 5
    assert {mark["ra"] for mark in stored} == {3.0, 4.0, 5.0, 6.0, 7.0}


def test_feed_requires_two_epochs(client, monkeypatch):
    from backend.api import routes

    monkeypatch.setitem(routes._catalog_cache, "records", {})
    monkeypatch.setitem(routes._catalog_cache, "expires_at", float("inf"))
    response = client.get("/api/feed").json()
    assert response["status"] == "empty"
    assert response["items"] == []
    assert "Fetch a position" in response["message"]
