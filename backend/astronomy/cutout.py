"""WCS-aligned, north-up cutouts for multi-epoch comparison.

Two SPHEREx observations of the same sky position are never pixel-aligned:
each visit has its own pointing and roll angle. This module resamples a small
patch of an observation onto a common north-up tangent-plane grid centered on
a requested RA/Dec, so that every epoch's cutout places the same sky position
on the same output pixel. That is the precondition for honest blinking,
time-series animation, and difference imaging.

Scientific caveats (kept in the returned provenance):
- The science image is bilinearly resampled, which slightly correlates
  neighboring pixels; the variance is resampled the same way and is therefore
  an approximation, adequate for display and prototype-grade significance maps
  but not for precision photometry.
- The validity mask is resampled with nearest-neighbor so masked detector
  pixels stay masked.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

from .fits_loader import FitsObservation

MAX_CUTOUT_SIZE = 512


def aligned_grid_wcs(ra: float, dec: float, fov_arcmin: float, size: int) -> WCS:
    """The shared tangent-plane grid every aligned cutout is resampled onto.

    Row 0 renders at the top of the delivered PNG, so declination decreases
    with row (north up) and RA decreases with column (east left) — the
    standard sky-chart orientation. Everything that must agree on sky-to-pixel
    mapping (cutouts, candidate coordinates, catalog overlays) derives it from
    this one function.
    """
    scale_deg = (fov_arcmin / 60.0) / size
    grid = WCS(naxis=2)
    grid.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    grid.wcs.crval = [ra, dec]
    grid.wcs.crpix = [(size + 1) / 2.0, (size + 1) / 2.0]
    grid.wcs.cdelt = [-scale_deg, -scale_deg]
    return grid


def observation_wcs(observation: FitsObservation) -> WCS | None:
    """Rebuild the observation's celestial WCS from its serialized cards."""
    cards = observation.header.get("WCS_CARDS")
    if not isinstance(cards, dict) or not cards:
        return None
    try:
        wcs = WCS(fits.Header(cards.items()))
    except Exception:  # noqa: BLE001 - malformed stored WCS means "no WCS"
        return None
    return wcs if wcs.has_celestial else None


def _header_shape(observation_header: dict[str, Any], fallback: tuple[int, int]) -> tuple[int, int]:
    """Pixel dimensions from header NAXIS keywords (cutout files are small)."""
    try:
        return int(observation_header["NAXIS2"]), int(observation_header["NAXIS1"])
    except (KeyError, TypeError, ValueError):
        return fallback


def contains_position(observation_header: dict[str, Any], ra: float, dec: float, shape: tuple[int, int] = (2040, 2040)) -> bool:
    """True when (ra, dec) falls on the pixel footprint of this observation."""
    cards = observation_header.get("WCS_CARDS")
    if not isinstance(cards, dict) or not cards:
        return False
    shape = _header_shape(observation_header, shape)
    try:
        wcs = WCS(fits.Header(cards.items()))
        x, y = wcs.celestial.wcs_world2pix([[ra, dec]], 0)[0]
    except Exception:  # noqa: BLE001 - unprojectable position is simply "not contained"
        return False
    height, width = shape
    return bool(np.isfinite(x) and np.isfinite(y) and 0 <= x < width and 0 <= y < height)


def footprint_coverage(
    observation_header: dict[str, Any],
    ra: float,
    dec: float,
    fov_arcmin: float,
    *,
    shape: tuple[int, int] = (2040, 2040),
    samples: int = 12,
) -> float | None:
    """Estimate what fraction of a cutout falls on this exposure's detector.

    Pure WCS math on a coarse sample grid — no pixel data is loaded — so the
    timeline can label partially covered frames cheaply. Returns None when the
    observation has no usable WCS.
    """
    cards = observation_header.get("WCS_CARDS")
    if not isinstance(cards, dict) or not cards:
        return None
    shape = _header_shape(observation_header, shape)
    try:
        wcs = WCS(fits.Header(cards.items())).celestial
        target = aligned_grid_wcs(ra, dec, fov_arcmin, samples)
        yy, xx = np.mgrid[0:samples, 0:samples]
        sky = target.wcs_pix2world(np.column_stack([xx.ravel(), yy.ravel()]), 0)
        source_xy = wcs.wcs_world2pix(sky, 0)
    except Exception:  # noqa: BLE001 - unprojectable means "unknown coverage"
        return None
    height, width = shape
    x, y = source_xy[:, 0], source_xy[:, 1]
    inside = np.isfinite(x) & np.isfinite(y) & (x >= 0) & (x < width) & (y >= 0) & (y < height)
    return float(inside.mean())


@dataclass(frozen=True)
class AlignedCutout:
    """A north-up resampled patch and its provenance."""

    image: np.ndarray
    variance: np.ndarray | None
    valid_mask: np.ndarray
    provenance: dict[str, Any]


def north_up_cutout(
    observation: FitsObservation,
    *,
    ra: float,
    dec: float,
    fov_arcmin: float,
    size: int = 256,
) -> AlignedCutout:
    """Resample a patch centered on (ra, dec) onto a north-up TAN grid.

    Every observation cut with the same (ra, dec, fov, size) lands on an
    identical sky grid, so the same output pixel is the same sky position in
    every epoch.
    """
    if not 0.0 <= ra < 360.0 or not -90.0 <= dec <= 90.0:
        raise ValueError("ra must be in [0, 360) and dec in [-90, 90]")
    if not 8 <= size <= MAX_CUTOUT_SIZE:
        raise ValueError(f"size must be between 8 and {MAX_CUTOUT_SIZE}")
    if not 0.5 <= fov_arcmin <= 240.0:
        raise ValueError("fov_arcmin must be between 0.5 and 240 arcminutes")

    source_wcs = observation_wcs(observation)
    if source_wcs is None:
        raise ValueError("observation carries no usable WCS; cannot produce an aligned cutout")
    source_wcs = source_wcs.celestial

    height, width = observation.image.shape
    center_x, center_y = source_wcs.wcs_world2pix([[ra, dec]], 0)[0]
    if not (np.isfinite(center_x) and np.isfinite(center_y) and 0 <= center_x < width and 0 <= center_y < height):
        raise ValueError("requested position is not on this observation's detector footprint")

    # Target grid: gnomonic (TAN) projection; row 0 (PNG top) is north,
    # column 0 (left) is east — the standard sky-chart orientation.
    target = aligned_grid_wcs(ra, dec, fov_arcmin, size)
    scale_deg = (fov_arcmin / 60.0) / size

    yy, xx = np.mgrid[0:size, 0:size]
    sky = target.wcs_pix2world(np.column_stack([xx.ravel(), yy.ravel()]), 0)
    source_xy = source_wcs.wcs_world2pix(sky, 0)
    sample_x = source_xy[:, 0].reshape(size, size)
    sample_y = source_xy[:, 1].reshape(size, size)
    coords = np.array([sample_y, sample_x])

    # Sample science values with invalid pixels zeroed (the mask, resampled
    # nearest-neighbor, marks them), so NaNs do not bleed into neighbors.
    safe_image = np.where(observation.valid_mask, np.nan_to_num(observation.image), 0.0).astype(np.float32)
    image = map_coordinates(safe_image, coords, order=1, mode="constant", cval=0.0)
    valid = (
        map_coordinates(observation.valid_mask.astype(np.float32), coords, order=0, mode="constant", cval=0.0)
        > 0.5
    )
    variance = None
    if observation.variance is not None:
        safe_variance = np.where(observation.valid_mask, np.nan_to_num(observation.variance), 0.0).astype(np.float32)
        variance = map_coordinates(safe_variance, coords, order=1, mode="constant", cval=0.0)
        valid &= variance > 0

    provenance = {
        "source_path": str(observation.path),
        "center_ra": ra,
        "center_dec": dec,
        "fov_arcmin": fov_arcmin,
        "size": size,
        "pixel_scale_arcsec": scale_deg * 3600.0,
        "projection": "TAN, north up / east left in the delivered image",
        "resampled": True,
        "resampling": "bilinear (science/variance), nearest (mask)",
        "caveat": "Resampled for alignment; adequate for display and prototype significance maps, not precision photometry.",
    }
    return AlignedCutout(image=image, variance=variance, valid_mask=valid, provenance=provenance)
