"""Deterministic image calibration for model input."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .fits_loader import FitsObservation


@dataclass(frozen=True)
class CalibratedImage:
    """Normalized science image and the mask used to create it."""

    image: np.ndarray
    valid_mask: np.ndarray
    lower: float
    upper: float
    fill_value: float


def robust_normalize(
    observation: FitsObservation,
    *,
    lower_percentile: float = 1.0,
    upper_percentile: float = 99.0,
    fill_value: float = 0.0,
) -> CalibratedImage:
    """Clip valid science values to robust percentiles and scale to [-1, 1].

    Percentiles are computed per observation from valid pixels only. The
    returned mask must be retained for masked loss and anomaly scoring.
    """

    if not 0 <= lower_percentile < upper_percentile <= 100:
        raise ValueError("percentiles must satisfy 0 <= lower < upper <= 100")
    valid = observation.valid_mask
    values = observation.image[valid]
    if values.size == 0:
        raise ValueError(f"observation has no valid pixels: {observation.path}")
    lower, upper = np.percentile(values, [lower_percentile, upper_percentile])
    if not np.isfinite(lower) or not np.isfinite(upper) or upper <= lower:
        raise ValueError(f"observation has no usable intensity range: {observation.path}")
    clipped = np.clip(observation.image, lower, upper)
    normalized = ((clipped - lower) / (upper - lower)) * 2.0 - 1.0
    normalized = normalized.astype(np.float32, copy=False)
    normalized[~valid] = fill_value
    return CalibratedImage(
        image=normalized,
        valid_mask=valid.astype(np.uint8, copy=False),
        lower=float(lower),
        upper=float(upper),
        fill_value=fill_value,
    )
