"""OpenCV-based candidate detection on rendered difference images.

This is a *visual aid* layer: it thresholds the rendered difference image
(where positive significance is red and negative is blue) and labels connected
changed regions. It is intentionally separate from ``difference.significance_map``,
which is the noise-normalized, WCS-aligned scientific baseline.

Every candidate produced here is an ``unclassified_candidate``, never a
confirmed detection.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

_MIN_AREA_PX = 4


def detect_changes(
    diff_rgb: np.ndarray,
    *,
    threshold: float | None = None,
    min_area: int = _MIN_AREA_PX,
) -> tuple[list[dict[str, Any]], np.ndarray]:
    """Label connected changed regions on a rendered RGB difference image.

    ``diff_rgb`` is the output of ``render.render_difference``: red = brighter in
    the context epoch, blue = brighter in the target epoch. The change magnitude
    is ``max(red, blue)``. Returns ``(candidates, mask)``.
    """
    red = diff_rgb[:, :, 2].astype(np.float32)
    blue = diff_rgb[:, :, 0].astype(np.float32)
    magnitude = np.maximum(red, blue).astype(np.uint8)

    if threshold is None:
        # Otsu over the non-saturated magnitude. This stays below 255 even when
        # the render clips, unlike a percentile threshold which degenerates to
        # 255 on saturated images and yields an empty mask.
        values = magnitude[magnitude < 255]
        if values.size > 0:
            threshold, _ = cv2.threshold(values, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            threshold = float(max(threshold, 30.0))
        else:
            threshold = 254.0
    _, mask = cv2.threshold(magnitude, threshold, 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[dict[str, Any]] = []
    for index, contour in enumerate(contours):
        x, y, w, h = cv2.boundingRect(contour)
        area = int(cv2.contourArea(contour))
        if area < min_area:
            continue
        inside = mask[y : y + h, x : x + w] > 0
        region_mag = magnitude[y : y + h, x : x + w].astype(np.float32)
        region_red = red[y : y + h, x : x + w]
        region_blue = blue[y : y + h, x : x + w]
        brightened = bool(region_red[inside].mean() > region_blue[inside].mean())
        candidates.append(
            {
                "candidate_id": f"cv2-{index:03d}",
                "row": int(y),
                "column": int(x),
                "height": int(h),
                "width": int(w),
                "area": area,
                "score": float(region_mag[inside].mean()),
                "sign": "brightened" if brightened else "dimmed",
                "coordinate_space": "aligned_cutout_pixel",
                "classification": "unclassified_candidate",
            }
        )
    return candidates, mask


def annotate(diff_rgb: np.ndarray, candidates: list[dict[str, Any]]) -> np.ndarray:
    """Draw candidate bounding boxes on a rendered difference image."""
    annotated = diff_rgb.copy()
    for candidate in candidates:
        x, y = candidate["column"], candidate["row"]
        w, h = candidate["width"], candidate["height"]
        color = (0, 200, 0) if candidate["sign"] == "brightened" else (200, 160, 0)
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, 2)
    return annotated
