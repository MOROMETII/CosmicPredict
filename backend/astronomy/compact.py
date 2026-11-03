"""Compact, uploadable serialization of a FITS observation.

The raw SPHEREx FITS products are ~71 MB (7 HDUs) and exceed Supabase's upload
limit, so we store only the science image and its validity mask as a compressed
``.npz`` (~14 MB). The header is kept in the ``observations`` table.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

from .fits_loader import FitsObservation


def observation_to_bytes(observation: FitsObservation) -> bytes:
    """Serialize the science image and validity mask to compressed npz bytes."""
    buffer = BytesIO()
    np.savez_compressed(
        buffer,
        image=np.asarray(observation.image, dtype=np.float32),
        valid_mask=np.asarray(observation.valid_mask, dtype=np.uint8),
    )
    return buffer.getvalue()


def observation_from_bytes(data: bytes, *, header: dict[str, Any], path: Path | str) -> FitsObservation:
    """Reconstruct a :class:`FitsObservation` from serialized npz bytes."""
    with np.load(BytesIO(data)) as archive:
        image = np.asarray(archive["image"], dtype=np.float32)
        valid_mask = np.asarray(archive["valid_mask"], dtype=bool)
    return FitsObservation(
        path=Path(path),
        image=image,
        variance=None,
        flags=None,
        header=dict(header),
        valid_mask=valid_mask,
    )
