"""Deterministic alignment and detection tests on synthetic FITS fixtures.

Two synthetic observations share one *fixed* star at known RA/Dec but have
different pointings and roll angles, plus an *injected moving source* that
shifts between epochs. These are synthetic test images, not SPHEREx data.

Verified behavior:
- the loader preserves a usable WCS;
- north-up cutouts place the same sky position on the same output pixel in
  both epochs regardless of pointing/rotation;
- the significance map on aligned cutouts recovers the injected change and
  does not flag the fixed star.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from astropy.io import fits

from backend.astronomy.cutout import contains_position, north_up_cutout
from backend.astronomy.difference import significance_map
from backend.astronomy.fits_loader import load_fits_observation

IMAGE_SIZE = 256
PIXEL_SCALE_DEG = 6.2 / 3600.0  # SPHEREx-like 6.2 arcsec pixels

FIXED_STAR = (150.020, 2.010)  # ra, dec of the star that must not move
CUTOUT_FOV_ARCMIN = 8.0
CUTOUT_SIZE = 128


def _add_gaussian(image: np.ndarray, x: float, y: float, flux: float, sigma: float = 1.5) -> None:
    yy, xx = np.mgrid[0:image.shape[0], 0:image.shape[1]]
    image += flux * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2.0 * sigma**2))


def _write_synthetic_fits(
    path: Path,
    *,
    center: tuple[float, float],
    rotation_deg: float,
    sources: list[tuple[float, float, float]],
    seed: int,
) -> None:
    """Write a synthetic observation with a rotated TAN WCS and known sources."""
    rng = np.random.default_rng(seed)
    image = rng.normal(0.0, 0.01, size=(IMAGE_SIZE, IMAGE_SIZE)).astype(np.float32)
    variance = np.full((IMAGE_SIZE, IMAGE_SIZE), 0.01**2, dtype=np.float32)
    flags = np.zeros((IMAGE_SIZE, IMAGE_SIZE), dtype=np.int32)

    theta = np.deg2rad(rotation_deg)
    header = fits.Header()
    header["CTYPE1"], header["CTYPE2"] = "RA---TAN", "DEC--TAN"
    header["CRVAL1"], header["CRVAL2"] = center
    header["CRPIX1"] = header["CRPIX2"] = (IMAGE_SIZE + 1) / 2.0
    header["CDELT1"], header["CDELT2"] = -PIXEL_SCALE_DEG, PIXEL_SCALE_DEG
    header["PC1_1"], header["PC1_2"] = np.cos(theta), -np.sin(theta)
    header["PC2_1"], header["PC2_2"] = np.sin(theta), np.cos(theta)
    header["DATE-OBS"] = "2025-08-01T00:00:00"
    header["DETECTOR"] = 3

    from astropy.wcs import WCS

    wcs = WCS(header)
    for ra, dec, flux in sources:
        x, y = wcs.wcs_world2pix([[ra, dec]], 0)[0]
        _add_gaussian(image, x, y, flux)

    fits.HDUList(
        [
            fits.PrimaryHDU(),
            fits.ImageHDU(data=image, header=header, name="IMAGE"),
            fits.ImageHDU(data=variance, name="VARIANCE"),
            fits.ImageHDU(data=flags, name="FLAGS"),
        ]
    ).writeto(path, overwrite=True)


@pytest.fixture()
def epoch_pair(tmp_path: Path):
    """Two epochs: fixed star in both; injected source moves ~25 arcsec east."""
    mover_a = (150.000, 2.000)
    mover_b = (150.000 + 25.0 / 3600.0, 2.000)
    path_a = tmp_path / "epoch_a.fits"
    path_b = tmp_path / "epoch_b.fits"
    _write_synthetic_fits(
        path_a,
        center=(150.0, 2.0),
        rotation_deg=0.0,
        sources=[(*FIXED_STAR, 1.0), (*mover_a, 1.0)],
        seed=1,
    )
    _write_synthetic_fits(
        path_b,
        center=(150.05, 2.03),  # different pointing
        rotation_deg=17.0,  # different roll angle
        sources=[(*FIXED_STAR, 1.0), (*mover_b, 1.0)],
        seed=2,
    )
    return load_fits_observation(path_a), load_fits_observation(path_b), mover_a, mover_b


def _peak_near(image: np.ndarray, x: float, y: float, radius: int = 4) -> float:
    top, bottom = int(y) - radius, int(y) + radius + 1
    left, right = int(x) - radius, int(x) + radius + 1
    return float(image[top:bottom, left:right].max())


def test_loader_preserves_wcs(epoch_pair) -> None:
    observation_a, observation_b, _, _ = epoch_pair
    for observation in (observation_a, observation_b):
        assert "WCS_CARDS" in observation.header
        assert contains_position(observation.header, *FIXED_STAR, shape=observation.image.shape)
    assert not contains_position(observation_a.header, 10.0, -45.0, shape=observation_a.image.shape)


def test_fixed_star_lands_on_same_pixel_in_both_epochs(epoch_pair) -> None:
    observation_a, observation_b, _, _ = epoch_pair
    peaks = []
    for observation in (observation_a, observation_b):
        aligned = north_up_cutout(
            observation, ra=FIXED_STAR[0], dec=FIXED_STAR[1], fov_arcmin=CUTOUT_FOV_ARCMIN, size=CUTOUT_SIZE
        )
        peak = np.unravel_index(np.nanargmax(aligned.image), aligned.image.shape)
        peaks.append(peak)
        # The star sits at the cutout center despite different pointing/rotation.
        assert abs(peak[0] - CUTOUT_SIZE / 2) <= 2.0
        assert abs(peak[1] - CUTOUT_SIZE / 2) <= 2.0
    assert abs(peaks[0][0] - peaks[1][0]) <= 2 and abs(peaks[0][1] - peaks[1][1]) <= 2


def test_injected_moving_source_is_detected_and_fixed_star_is_not(epoch_pair) -> None:
    observation_a, observation_b, mover_a, _ = epoch_pair
    center_ra, center_dec = mover_a
    cut_a = north_up_cutout(observation_a, ra=center_ra, dec=center_dec, fov_arcmin=CUTOUT_FOV_ARCMIN, size=CUTOUT_SIZE)
    cut_b = north_up_cutout(observation_b, ra=center_ra, dec=center_dec, fov_arcmin=CUTOUT_FOV_ARCMIN, size=CUTOUT_SIZE)
    significance, valid = significance_map(
        cut_a.image, cut_a.variance, cut_a.valid_mask, cut_b.image, cut_b.variance, cut_b.valid_mask
    )
    assert valid.mean() > 0.9

    scale_arcsec = CUTOUT_FOV_ARCMIN * 60.0 / CUTOUT_SIZE
    center = CUTOUT_SIZE / 2.0
    # Epoch A position (center) should be strongly positive; epoch B position
    # (25 arcsec east = lower x in a north-up, east-left grid) strongly negative.
    shift_px = 25.0 / scale_arcsec
    assert _peak_near(significance, center, center) > 5.0
    assert _peak_near(-significance, center - shift_px, center) > 5.0

    # The fixed star subtracts away: no 5-sigma residual at its location.
    fixed_cut_a = north_up_cutout(observation_a, ra=FIXED_STAR[0], dec=FIXED_STAR[1], fov_arcmin=CUTOUT_FOV_ARCMIN, size=CUTOUT_SIZE)
    fixed_cut_b = north_up_cutout(observation_b, ra=FIXED_STAR[0], dec=FIXED_STAR[1], fov_arcmin=CUTOUT_FOV_ARCMIN, size=CUTOUT_SIZE)
    fixed_significance, _ = significance_map(
        fixed_cut_a.image,
        fixed_cut_a.variance,
        fixed_cut_a.valid_mask,
        fixed_cut_b.image,
        fixed_cut_b.variance,
        fixed_cut_b.valid_mask,
    )
    assert abs(_peak_near(np.abs(fixed_significance), center, center)) < 5.0


def test_cutout_rejects_offdetector_position(epoch_pair) -> None:
    observation_a, _, _, _ = epoch_pair
    with pytest.raises(ValueError, match="footprint"):
        north_up_cutout(observation_a, ra=10.0, dec=-45.0, fov_arcmin=CUTOUT_FOV_ARCMIN, size=CUTOUT_SIZE)
