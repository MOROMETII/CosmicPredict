"""Prepare downloaded FITS observations as ViT-ready training patches.

The output contains normalized image patches, quality masks, and a manifest
with source/provenance information. Files that cannot be read as complete
FITS products are reported and skipped unless ``--strict`` is supplied.

Example:
    python scripts/preprocess.py --input data/raw --output data/processed
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

# Support `python scripts/preprocess.py` from the repository root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.astronomy.calibration import robust_normalize
from backend.astronomy.fits_loader import load_fits_observation


def _patch_slices(length: int, patch_size: int, stride: int) -> list[int]:
    if patch_size < 8 or stride < 1:
        raise ValueError("patch_size must be at least 8 and stride must be positive")
    if length < patch_size:
        return []
    starts = list(range(0, length - patch_size + 1, stride))
    final = length - patch_size
    if starts[-1] != final:
        starts.append(final)
    return starts


def preprocess_directory(
    input_dir: str | Path,
    output_dir: str | Path,
    *,
    patch_size: int = 128,
    stride: int = 128,
    strict: bool = False,
) -> Path:
    """Convert all FITS files in a directory into deterministic `.npz` patches."""

    source_dir = Path(input_dir)
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    fits_paths = sorted(source_dir.glob("*.fits"))
    if not fits_paths:
        raise FileNotFoundError(f"no FITS files found in {source_dir}")
    samples: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for observation_index, path in enumerate(fits_paths):
        try:
            observation = load_fits_observation(path)
            calibrated = robust_normalize(observation)
            rows = _patch_slices(calibrated.image.shape[0], patch_size, stride)
            columns = _patch_slices(calibrated.image.shape[1], patch_size, stride)
            if not rows or not columns:
                raise ValueError(f"image is smaller than patch size {patch_size}")
            for row in rows:
                for column in columns:
                    image = calibrated.image[row : row + patch_size, column : column + patch_size]
                    valid_mask = calibrated.valid_mask[row : row + patch_size, column : column + patch_size]
                    sample_name = (
                        f"obs_{observation_index:03d}_r{row:04d}_c{column:04d}.npz"
                    )
                    np.savez_compressed(
                        destination / sample_name,
                        image=image,
                        valid_mask=valid_mask,
                    )
                    samples.append(
                        {
                            "sample_path": sample_name,
                            "source_path": str(path),
                            "observation_index": observation_index,
                            "row": row,
                            "column": column,
                            "shape": [patch_size, patch_size],
                            "normalization": {
                                "lower": calibrated.lower,
                                "upper": calibrated.upper,
                                "fill_value": calibrated.fill_value,
                            },
                            "provenance": observation.header,
                        }
                    )
        except (OSError, ValueError, TypeError) as error:
            error_record = {"source_path": str(path), "error": str(error)}
            errors.append(error_record)
            print(f"skipping {path}: {error}", file=sys.stderr)
            if strict:
                raise
    if not samples:
        raise ValueError("no valid training samples were produced")
    manifest_path = destination / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "format": "cosmic-predict-patches-v1",
                "patch_size": patch_size,
                "stride": stride,
                "samples": samples,
                "errors": errors,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return manifest_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/raw"))
    parser.add_argument("--output", type=Path, default=Path("data/processed"))
    parser.add_argument("--patch-size", type=int, default=128)
    parser.add_argument("--stride", type=int, default=128)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args(argv)
    try:
        manifest_path = preprocess_directory(
            args.input,
            args.output,
            patch_size=args.patch_size,
            stride=args.stride,
            strict=args.strict,
        )
    except (OSError, ValueError, TypeError) as error:
        print(f"preprocessing failed: {error}", file=sys.stderr)
        return 1
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    print(f"wrote {len(payload['samples'])} samples to {manifest_path}")
    if payload["errors"]:
        print(f"skipped {len(payload['errors'])} invalid FITS file(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
