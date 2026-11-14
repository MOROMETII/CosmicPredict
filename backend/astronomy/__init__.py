"""Astronomy data loading and preparation utilities."""

from .fits_loader import FitsObservation, load_fits_observation

__all__ = ["FitsObservation", "load_fits_observation"]
