"""Scientifically grounded rendering of SPHEREx images for browser delivery.

Uses ``astropy.visualization`` for standard astronomical intensity scaling and
maps each detector's infrared wavelength to a color so a single-band image
visually encodes its spectral channel.
"""

from __future__ import annotations

import numpy as np
from astropy.visualization import AsinhStretch, PercentileInterval

# SPHEREx covers ~0.75-5 um across six linear-variable-filter detectors. These
# anchors map central wavelength (micron) to a display color so short-infrared
# channels read blue and long-infrared channels read red.
_WAVELENGTH_STOPS = np.array([0.75, 1.2, 2.2, 3.2, 4.5, 5.0], dtype=np.float32)
_WAVELENGTH_COLORS = np.array(
    [
        [0.10, 0.20, 1.00],
        [0.00, 0.65, 1.00],
        [0.20, 1.00, 0.30],
        [1.00, 0.90, 0.10],
        [1.00, 0.40, 0.00],
        [1.00, 0.10, 0.00],
    ],
    dtype=np.float32,
)


def wavelength_to_rgb(wavelength: float) -> np.ndarray:
    """Map an infrared wavelength (microns) to an RGB display color."""
    return np.stack(
        [np.interp(wavelength, _WAVELENGTH_STOPS, _WAVELENGTH_COLORS[:, channel]) for channel in range(3)]
    ).astype(np.float32)


def _stretch(data: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Apply a robust percentile + asinh stretch, returning values in [0, 1]."""
    values = data[valid]
    if values.size == 0:
        raise ValueError("image has no valid pixels")
    interval = PercentileInterval(99.5)
    vmin, vmax = interval.get_limits(values)
    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
        raise ValueError("image has no usable intensity range")
    normalized = (np.clip(data, vmin, vmax) - vmin) / (vmax - vmin)
    stretch = AsinhStretch(a=0.1)
    return stretch(normalized)


def render_mono(image: np.ndarray, valid_mask: np.ndarray, wavelength: float | None = None) -> np.ndarray:
    """Render a single science image to an RGB uint8 array.

    Brightness encodes intensity (asinh-stretched); the hue encodes the
    detector's infrared wavelength when available.
    """
    stretched = _stretch(image, valid_mask)
    tint = wavelength_to_rgb(wavelength) if wavelength is not None else np.array([1.0, 1.0, 1.0], dtype=np.float32)
    rgb = np.clip(stretched[..., None] * tint[None, None, :], 0.0, 1.0)
    rgb[~valid_mask] = 0.0
    return (rgb * 255.0).astype(np.uint8)


def render_difference(significance: np.ndarray, valid_mask: np.ndarray, symmetric_limit: float = 8.0) -> np.ndarray:
    """Render an uncertainty-normalized difference as a diverging image.

    Positive significance -> red, negative -> blue, near zero -> dark.
    """
    clipped = np.clip(significance, -symmetric_limit, symmetric_limit) / symmetric_limit
    red = np.clip(clipped, 0.0, 1.0)
    blue = np.clip(-clipped, 0.0, 1.0)
    green = np.full_like(red, 0.03)
    rgb = np.stack([red, green, blue], axis=-1)
    rgb[~valid_mask] = 0.0
    return (rgb * 255.0).astype(np.uint8)
