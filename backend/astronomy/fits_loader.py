"""Load SPHEREx FITS science, variance, and quality data."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sys

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

# FLAGS bits that mark unusable pixels (detector defects and processing
# artifacts). The SOURCE bit (21) and FULLSAMPLE bit (12) are intentionally
# NOT masked: they mark real astronomical detections, not defects. Masking them
# would punch "holes" where stars and galaxies are.
_BAD_FLAG_BITS = (0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 14, 15, 17, 19, 22, 23, 24, 26, 27, 28)
_BAD_FLAG_MASK = sum(1 << bit for bit in _BAD_FLAG_BITS)


def _flags_are_bad(flags: np.ndarray) -> np.ndarray:
    return (np.asarray(flags) & _BAD_FLAG_MASK) != 0


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
        "DETECTOR",
    )
    metadata = {key: header[key] for key in keys if key in header}
    # Preserve the complete celestial WCS (reference pixel, rotation matrix,
    # and distortion terms), without which pixel<->sky conversion — and thus
    # any alignment or sky-centered cutout — is impossible. Serialized as a
    # plain card dict so it survives JSON round-trips (Supabase jsonb).
    try:
        wcs = WCS(header)
        if wcs.has_celestial:
            metadata["WCS_CARDS"] = {
                card.keyword: card.value for card in wcs.to_header(relax=True).cards
            }
    except Exception as error:  # noqa: BLE001 - a broken WCS must not block image loading
        print(f"could not serialize WCS: {error}", file=sys.stderr)
    return metadata


def _wavelength_from_wave(hdul: fits.HDUList) -> float | None:
    """Return the representative central wavelength (microns) from WCS-WAVE."""
    try:
        table = hdul["WCS-WAVE"].data
        values = np.asarray(table["VALUES"])
        wavelengths = values[..., 0]
        finite = wavelengths[np.isfinite(wavelengths)]
        if finite.size:
            return float(np.median(finite))
    except (KeyError, IndexError, TypeError, ValueError):
        pass
    return None


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
                valid_mask &= ~_flags_are_bad(flags)
            header = _header_metadata(science_hdu.header)
            # Record the pixel dimensions so footprint checks work for
            # partial-frame (cutout) files, not just full 2040x2040 detectors.
            header["NAXIS2"], header["NAXIS1"] = int(image.shape[0]), int(image.shape[1])
            wavelength = _wavelength_from_wave(hdul)
            if wavelength is not None:
                header["WAVELENGTH"] = wavelength
            return FitsObservation(
                path=file_path,
                image=image,
                variance=variance,
                flags=flags,
                header=header,
                valid_mask=valid_mask,
            )
    except (OSError, ValueError, TypeError) as error:
        raise ValueError(f"could not read valid FITS observation {file_path}: {error}") from error
