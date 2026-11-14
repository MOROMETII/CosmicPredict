"""Load SPHEREx FITS science, variance, and quality data."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io import fits


@dataclass(frozen=True)
class FitsObservation:
    """One validated FITS observation and its provenance metadata."""

    path: Path
    image: np.ndarray
    variance: np.ndarray | None
    flags: np.ndarray | None
    header: dict[str, Any]
    valid_mask: np.ndarray

    @property
    def shape(self) -> tuple[int, int]:
        return tuple(self.image.shape)  # type: ignore[return-value]


def _find_hdu(hdul: fits.HDUList, names: tuple[str, ...]) -> fits.ImageHDU | None:
    for name in names:
        try:
            hdu = hdul[name]
        except KeyError:
            continue
        if hdu.data is not None:
            return hdu
    return None


def _header_metadata(header: fits.Header) -> dict[str, Any]:
    keys = (
        "DATE-OBS",
        "DATE-END",
        "CRVAL1",
        "CRVAL2",
        "CTYPE1",
        "CTYPE2",
        "CDELT1",
        "CDELT2",
        "BUNIT",
        "TELESCOP",
        "INSTRUME",
    )
    return {key: header[key] for key in keys if key in header}


def load_fits_observation(
    path: str | Path,
    *,
    science_hdus: tuple[str, ...] = ("IMAGE", "SCI", "SCIENCE"),
    variance_hdus: tuple[str, ...] = ("VARIANCE", "ERR", "ERROR", "UNCERTAINTY"),
    flags_hdus: tuple[str, ...] = ("FLAGS", "QUALITY", "DQ", "MASK"),
    require_variance: bool = False,
    require_flags: bool = False,
) -> FitsObservation:
    """Load a science image and optional quality arrays from a FITS file.

    A pixel is valid only when it is finite, has positive finite variance when
    available, and has zero quality flags when a flags HDU is present.
    """

    file_path = Path(path)
    if not file_path.is_file():
        raise FileNotFoundError(f"FITS file does not exist: {file_path}")
    try:
        with fits.open(file_path, memmap=True) as hdul:
            science_hdu = _find_hdu(hdul, science_hdus)
            if science_hdu is None:
                raise ValueError(f"no science HDU found in {file_path}")
            image = np.asarray(science_hdu.data, dtype=np.float32)
            if image.ndim != 2:
                raise ValueError(f"science HDU must be 2-D, got shape {image.shape}")
            variance_hdu = _find_hdu(hdul, variance_hdus)
            flags_hdu = _find_hdu(hdul, flags_hdus)
            if require_variance and variance_hdu is None:
                raise ValueError(f"variance HDU is required but missing in {file_path}")
            if require_flags and flags_hdu is None:
                raise ValueError(f"flags HDU is required but missing in {file_path}")
            variance = None if variance_hdu is None else np.asarray(variance_hdu.data, dtype=np.float32)
            flags = None if flags_hdu is None else np.asarray(flags_hdu.data)
            if variance is not None and variance.shape != image.shape:
                raise ValueError("variance and science arrays have different shapes")
            if flags is not None and flags.shape != image.shape:
                raise ValueError("flags and science arrays have different shapes")
            valid_mask = np.isfinite(image)
            if variance is not None:
                valid_mask &= np.isfinite(variance) & (variance > 0)
            if flags is not None:
                valid_mask &= flags == 0
            return FitsObservation(
                path=file_path,
                image=image,
                variance=variance,
                flags=flags,
                header=_header_metadata(science_hdu.header),
                valid_mask=valid_mask,
            )
    except (OSError, ValueError, TypeError) as error:
        raise ValueError(f"could not read valid FITS observation {file_path}: {error}") from error
