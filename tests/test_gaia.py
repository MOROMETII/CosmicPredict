"""Tests for the Gaia DR3 client, the shared grid orientation, and candidate enrichment."""

from __future__ import annotations

import json

import pytest

from backend import config
from backend.astronomy.cutout import aligned_grid_wcs
from backend.storage import gaia


@pytest.fixture(autouse=True)
def _isolated_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "RAW_DIR", tmp_path / "raw")


def _tap_payload(rows: list[list]) -> bytes:
    return json.dumps(
        {
            "metadata": [
                {"name": name}
                for name in [
                    "source_id",
                    "ra",
                    "dec",
                    "phot_g_mean_mag",
                    "pmra",
                    "pmdec",
                    "parallax",
                    "phot_variable_flag",
                ]
            ],
            "data": rows,
        }
    ).encode()


def test_cone_search_parses_tap_json_and_caches(monkeypatch):
    calls = []

    def fake_http_get(url, timeout, attempts=3):
        calls.append(url)
        return _tap_payload(
            [
                [4472832130942575872, 269.4521, 4.6934, 9.5, -802.8, 10362.4, 546.9, "VARIABLE"],
                [4472832130942575999, 269.4600, 4.6900, 15.2, None, None, None, "NOT_AVAILABLE"],
            ]
        )

    monkeypatch.setattr(gaia, "http_get", fake_http_get)
    sources, provenance = gaia.cone_search(269.454, 4.693, radius_arcmin=10.0)
    assert len(sources) == 2
    assert sources[0].source_id == "4472832130942575872"
    assert sources[0].variable_flag == "VARIABLE"
    assert sources[0].pm_total == pytest.approx(10393.4, rel=1e-3)
    assert sources[1].pm_total is None
    assert provenance["catalog"] == "Gaia DR3 (ESA)"
    assert provenance["cache"] == "miss"

    # Second call must come from the disk cache: no new HTTP request.
    cached_sources, cached_provenance = gaia.cone_search(269.454, 4.693, radius_arcmin=10.0)
    assert len(calls) == 1
    assert cached_provenance["cache"] == "hit"
    assert cached_sources[0].source_id == sources[0].source_id


def test_cone_search_reports_unavailable_instead_of_fabricating(monkeypatch):
    def failing_http_get(url, timeout, attempts=3):
        raise OSError("network down")

    monkeypatch.setattr(gaia, "http_get", failing_http_get)
    with pytest.raises(gaia.GaiaUnavailableError):
        gaia.cone_search(100.0, 10.0, radius_arcmin=10.0)


def test_aligned_grid_is_north_up_east_left():
    """Row 0 (PNG top) must be north; column 0 (left) must be east."""
    grid = aligned_grid_wcs(ra=180.0, dec=0.0, fov_arcmin=15.0, size=256)
    (top_ra, top_dec), (bottom_ra, bottom_dec) = grid.wcs_pix2world([[128, 0], [128, 255]], 0)
    assert top_dec > bottom_dec  # north at the top
    (left_ra, _), (right_ra, _) = grid.wcs_pix2world([[0, 128], [255, 128]], 0)
    assert left_ra > right_ra  # east (increasing RA) on the left
    # The grid center is the requested position.
    (center_ra, center_dec) = grid.wcs_pix2world([[127.5, 127.5]], 0)[0]
    assert center_ra == pytest.approx(180.0, abs=1e-6)
    assert center_dec == pytest.approx(0.0, abs=1e-6)


def test_candidate_enrichment_marks_known_star_and_uncatalogued(monkeypatch):
    from backend.api import routes

    ra, dec, fov, size = 180.0, 0.0, 15.0, 256
    grid = aligned_grid_wcs(ra, dec, fov, size)
    # A fake Gaia star exactly at the frame center.
    known = gaia.GaiaSource(
        source_id="42",
        ra=ra,
        dec=dec,
        g_mag=12.0,
        pm_ra=300.0,
        pm_dec=0.0,
        parallax=50.0,
        variable_flag="VARIABLE",
    )
    monkeypatch.setattr(
        "backend.storage.gaia.cone_search", lambda *args, **kwargs: ([known], {"catalog": "Gaia DR3 (ESA)"})
    )

    center = {"row": 124, "column": 124, "width": 8, "height": 8}  # centered on the star
    corner = {"row": 4, "column": 4, "width": 4, "height": 4}  # far from it
    candidates = [dict(candidate_id="c0", **center), dict(candidate_id="c1", **corner)]
    enriched, caveats = routes._enrich_candidates_with_gaia(candidates, ra, dec, fov, size)

    assert enriched[0]["gaia_checked"] and enriched[1]["gaia_checked"]
    assert enriched[0]["gaia_match"] is not None
    assert enriched[0]["gaia_match"].source_id == "42"
    assert "variable" in enriched[0]["interpretation"].lower()
    assert enriched[1].get("gaia_match") is None
    assert "not explained" in enriched[1]["interpretation"]
    assert any("Gaia DR3" in caveat for caveat in caveats)
    # Sky coordinates: candidate c0's center pixel is within a pixel of the
    # frame center (the box center lands half a pixel off the exact middle).
    assert enriched[0]["ra"] == pytest.approx(ra, abs=1e-3)
    assert enriched[0]["dec"] == pytest.approx(dec, abs=1e-3)
    # Reality check: the WCS reproduces the candidate position round-trip.
    x, y = grid.wcs_world2pix([[enriched[0]["ra"], enriched[0]["dec"]]], 0)[0]
    assert x == pytest.approx(128.0, abs=0.01)
    assert y == pytest.approx(128.0, abs=0.01)
