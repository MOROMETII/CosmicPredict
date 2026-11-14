"""Automated sky-region explorer backed by OpenCV.

Given one or more RA/Dec positions, this tool drives the COSMIC PREDICT backend
(the "tool calls" for seeing space) end to end:

1. queries ``GET /api/timeline`` for the region's observation epochs;
2. downloads the two extreme epochs' aligned cutouts and the aligned difference
   image (``GET /api/diff/aligned``);
3. detects candidate changed regions with OpenCV (threshold + connected
   components on the difference magnitude);
4. visualizes them (bounding boxes, sign-colored) and writes an annotated
   montage plus a JSON report.

The OpenCV step here is a *display-grade visual aid* on rendered PNGs. It is not
the backend's noise-normalized, WCS-aligned significance detection; treat every
box as an ``unclassified_candidate``, never a confirmed detection.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import cv2
import numpy as np

_BASE_URL = "http://localhost:8000"
_UA = "cosmic-predict-region-explorer/0.1"
_MIN_AREA_PX = 4


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _get_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _timeline(base_url: str, ra: float, dec: float, fov: float) -> dict[str, Any]:
    params = urllib.parse.urlencode({"ra": ra, "dec": dec, "fov": fov})
    return _get_json(f"{base_url}/api/timeline?{params}")


def _frames_for_pair(timeline: dict[str, Any]) -> list[dict[str, Any]]:
    """Pick the two most time-separated frames, or whatever is available."""
    frames = timeline.get("frames") or []
    if len(frames) >= 2:
        return [frames[0], frames[-1]]
    return frames


def _decode_png(payload: bytes) -> np.ndarray:
    array = np.frombuffer(payload, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("could not decode PNG payload")
    return image


def detect_changes(
    diff_bgr: np.ndarray,
    *,
    threshold: float | None = None,
    min_area: int = _MIN_AREA_PX,
) -> tuple[list[dict[str, Any]], np.ndarray]:
    """Find connected changed regions on a rendered difference image.

    The backend renders positive significance red and negative blue, so the
    change magnitude is ``max(red, blue)``. Returns (candidates, mask).
    """
    red = diff_bgr[:, :, 2].astype(np.float32)
    blue = diff_bgr[:, :, 0].astype(np.float32)
    magnitude = np.maximum(red, blue).astype(np.uint8)

    if threshold is None:
        # Auto: Otsu over the non-saturated change magnitude. This stays below
        # 255 even when the render clips, unlike a percentile threshold which
        # degenerates to 255 on saturated images and yields an empty mask.
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
        mask_inside = mask[y : y + h, x : x + w] > 0
        region_mag = magnitude[y : y + h, x : x + w].astype(np.float32)
        region_red = red[y : y + h, x : x + w]
        region_blue = blue[y : y + h, x : x + w]
        brightened = bool(region_red[mask_inside].mean() > region_blue[mask_inside].mean())
        candidates.append(
            {
                "candidate_id": f"cv2-{index:03d}",
                "row": int(y),
                "column": int(x),
                "height": int(h),
                "width": int(w),
                "area": area,
                "score": float(region_mag[mask_inside].mean()),
                "sign": "brightened" if brightened else "dimmed",
                "coordinate_space": "diff_image_pixel",
                "classification": "unclassified_candidate",
            }
        )
    return candidates, mask


def _annotate(diff_bgr: np.ndarray, candidates: list[dict[str, Any]]) -> np.ndarray:
    annotated = diff_bgr.copy()
    for candidate in candidates:
        x, y = candidate["column"], candidate["row"]
        w, h = candidate["width"], candidate["height"]
        color = (0, 200, 0) if candidate["sign"] == "brightened" else (200, 160, 0)
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, 2)
    return annotated


def _montage(context_bgr: np.ndarray, target_bgr: np.ndarray, annotated: np.ndarray) -> np.ndarray:
    height = annotated.shape[0]
    width = annotated.shape[1]

    def fit(image: np.ndarray) -> np.ndarray:
        return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)

    context = fit(context_bgr)
    target = fit(target_bgr)
    labels = [context, target, annotated]
    labeled = []
    for index, image in enumerate(labels):
        header = np.full((28, width, 3), 20, dtype=np.uint8)
        caption = ["context epoch", "target epoch", "difference (candidates)"][index]
        cv2.putText(header, caption, (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        labeled.append(np.vstack([header, image]))
    return np.hstack(labeled)


def explore_region(
    base_url: str,
    ra: float,
    dec: float,
    fov: float,
    size: int,
    out_dir: Path,
    *,
    threshold: float | None,
    min_area: int,
) -> dict[str, Any]:
    timeline = _timeline(base_url, ra, dec, fov)
    frames = _frames_for_pair(timeline)
    region_tag = f"ra{ra:.4f}_dec{dec:.4f}".replace(".", "p").replace("-", "m")

    if len(frames) < 2:
        return {
            "region": region_tag,
            "ra": ra,
            "dec": dec,
            "status": "insufficient_epochs",
            "band": timeline.get("band"),
            "frame_count": len(frames),
            "candidates": [],
            "message": timeline.get("message") or "fewer than two epochs cover this position",
        }

    context = frames[0]
    target = frames[-1]

    def cutout_url(observation_id: str) -> str:
        params = urllib.parse.urlencode({"ra": ra, "dec": dec, "fov": fov, "size": size})
        return f"{base_url}/api/cutout/{urllib.parse.quote(observation_id)}?{params}"

    diff_params = urllib.parse.urlencode(
        {"context_epoch": context["observation_id"], "target_epoch": target["observation_id"], "ra": ra, "dec": dec, "fov": fov, "size": size}
    )
    diff_url = f"{base_url}/api/diff/aligned?{diff_params}"

    context_bgr = _decode_png(_get_bytes(cutout_url(context["observation_id"])))
    target_bgr = _decode_png(_get_bytes(cutout_url(target["observation_id"])))
    diff_bgr = _decode_png(_get_bytes(diff_url))

    candidates, _mask = detect_changes(diff_bgr, threshold=threshold, min_area=min_area)
    annotated = _annotate(diff_bgr, candidates)
    montage = _montage(context_bgr, target_bgr, annotated)

    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / f"{region_tag}_diff_annotated.png"), annotated)
    cv2.imwrite(str(out_dir / f"{region_tag}_montage.png"), montage)

    report = {
        "region": region_tag,
        "ra": ra,
        "dec": dec,
        "fov_arcmin": fov,
        "status": "ok",
        "band": timeline.get("band"),
        "context_epoch": context.get("epoch"),
        "target_epoch": target.get("epoch"),
        "context_observation_id": context["observation_id"],
        "target_observation_id": target["observation_id"],
        "candidate_count": len(candidates),
        "candidates": candidates,
        "artifacts": {
            "annotated": str(out_dir / f"{region_tag}_diff_annotated.png"),
            "montage": str(out_dir / f"{region_tag}_montage.png"),
        },
        "caveats": [
            "OpenCV candidates are a visual aid on rendered PNGs, not the backend's noise-normalized significance detection.",
            "Every candidate is unclassified and requires scientific validation.",
            "Sign is relative to the rendered stretch, not calibrated photometry.",
        ],
    }
    (out_dir / f"{region_tag}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Explore sky regions with the backend + OpenCV.")
    parser.add_argument("--ra", type=float, required=True, help="right ascension (degrees)")
    parser.add_argument("--dec", type=float, required=True, help="declination (degrees)")
    parser.add_argument("--fov", type=float, default=24.0, help="field of view (arcmin)")
    parser.add_argument("--size", type=int, default=256, help="cutout size in pixels")
    parser.add_argument("--base-url", default=_BASE_URL, help="backend base URL")
    parser.add_argument("--out", default="data/explorations", help="output directory")
    parser.add_argument("--threshold", type=float, default=None, help="override detection threshold (0-255)")
    parser.add_argument("--min-area", type=int, default=_MIN_AREA_PX, help="minimum candidate area in pixels")
    args = parser.parse_args(argv)

    report = explore_region(
        args.base_url,
        args.ra,
        args.dec,
        args.fov,
        args.size,
        Path(args.out),
        threshold=args.threshold,
        min_area=args.min_area,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
