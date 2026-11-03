"""Uncertainty-aware difference imaging for a pair of observations."""

from __future__ import annotations

import numpy as np


def significance_map(
    image_a: np.ndarray,
    variance_a: np.ndarray | None,
    valid_a: np.ndarray,
    image_b: np.ndarray,
    variance_b: np.ndarray | None,
    valid_b: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute the noise-normalized difference (significance) of two images.

    Returns ``(significance, valid)`` where ``significance`` is
    ``(A - B) / sqrt(var_A + var_B)`` on pixels valid in both images, in the
    same physical units as the science arrays (MJy/sr), and ``valid`` is the
    boolean mask of pixels where the significance is defined.
    """
    if image_a.shape != image_b.shape:
        raise ValueError("images must have identical shapes")
    valid = valid_a & valid_b & np.isfinite(image_a) & np.isfinite(image_b)

    var_sum = np.zeros(image_a.shape, dtype=np.float32)
    if variance_a is not None:
        var_sum = var_sum + np.asarray(variance_a, dtype=np.float32)
    if variance_b is not None:
        var_sum = var_sum + np.asarray(variance_b, dtype=np.float32)
    valid &= np.isfinite(var_sum) & (var_sum > 0)

    significance = np.full(image_a.shape, np.nan, dtype=np.float32)
    significance[valid] = (image_a[valid] - image_b[valid]) / np.sqrt(var_sum[valid])
    return significance, valid
