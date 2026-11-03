"""Compact, uploadable serialization of a FITS observation.

The raw SPHEREx FITS products are ~71 MB (7 HDUs) and exceed Supabase's upload
limit, so we store the science image, its validity mask, and its variance map
as a compressed ``.npz`` (~28 MB). The header is kept in the ``observations``
table.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

from .fits_loader import FitsObservation


def observation_to_bytes(observation: FitsObservation) -> bytes:
    """Serialize the science image, variance, and validity mask to npz bytes."""
    arrays: dict[str, np.ndarray] = {
        "image": np.asarray(observation.image, dtype=np.float32),
        "valid_mask": np.asarray(observation.valid_mask, dtype=np.uint8),
    }
    if observation.variance is not None:
        # Half precision is enough for the noise-variance weighting used in
        # significance maps and keeps snapshots within Supabase storage limits.
        # Clean non-finite and clamp out-of-range values (masked pixels anyway).
        variance = np.asarray(observation.variance, dtype=np.float32)
        variance = np.nan_to_num(variance, nan=0.0, posinf=0.0, neginf=0.0)
        variance = np.clip(variance, 0.0, np.finfo(np.float16).max)
        arrays["variance"] = variance.astype(np.float16)
    buffer = BytesIO()
    np.savez_compressed(buffer, **arrays)
    return buffer.getvalue()


def observation_from_bytes(data: bytes, *, header: dict[str, Any], path: Path | str) -> FitsObservation:
    """Reconstruct a :class:`FitsObservation` from serialized npz bytes."""
    with np.load(BytesIO(data)) as archive:
        image = np.asarray(archive["image"], dtype=np.float32)
        valid_mask = np.asarray(archive["valid_mask"], dtype=bool)
        variance = np.asarray(archive["variance"], dtype=np.float32) if "variance" in archive.files else None
    return FitsObservation(
        path=Path(path),
        image=image,
        variance=variance,
        flags=None,
        header=dict(header),
        valid_mask=valid_mask,
    )
