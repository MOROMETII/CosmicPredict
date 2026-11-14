"""Stable frontend-facing API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ObservationResponse(BaseModel):
    observation_id: str
    epoch: datetime | None
    band: str | None
    wavelength: float | None = None
    ra: float | None
    dec: float | None
    source: str = "cached"
    provenance: dict[str, Any] = Field(default_factory=dict)
    image_url: str | None = None
    asset_status: str = "metadata_only"


class EpochsResponse(BaseModel):
    status: str
    observations: list[ObservationResponse]
    message: str | None = None


class TimelineFrame(BaseModel):
    observation_id: str
    epoch: datetime | None
    band: str | None
    wavelength: float | None = None
    cutout_url: str
    source: str = "cached"
    coverage: float | None = None  # fraction of the cutout on this exposure's detector


class SpectrumPoint(BaseModel):
    observation_id: str
    epoch: datetime | None
    band: str | None
    wavelength: float
    surface_brightness: float
    unit: str = "MJy/sr"


class SpectrumResponse(BaseModel):
    status: str
    ra: float
    dec: float
    points: list[SpectrumPoint] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    message: str | None = None


class TimelineResponse(BaseModel):
    status: str
    ra: float
    dec: float
    fov_arcmin: float
    band: str | None
    available_bands: dict[str, int] = Field(default_factory=dict)
    frames: list[TimelineFrame] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    message: str | None = None


class AnalyzeRequest(BaseModel):
    context_epoch: str
    target_epoch: str
    band: str | None = None
    row: int = Field(default=0, ge=0)
    column: int = Field(default=0, ge=0)
    size: int = Field(default=128, ge=8, le=1024, multiple_of=8)


class AnalyzeRegionRequest(BaseModel):
    """Compare two epochs on the shared north-up cutout grid at (ra, dec)."""

    context_epoch: str
    target_epoch: str
    ra: float = Field(..., ge=0, lt=360)
    dec: float = Field(..., ge=-90, le=90)
    fov_arcmin: float = Field(default=15.0, ge=0.5, le=240.0)
    size: int = Field(default=256, ge=8, le=512)


class CandidateResponse(BaseModel):
    candidate_id: str
    source: str
    classification: str = "unclassified_candidate"
    row: int
    column: int
    height: int
    width: int
    area: int
    score: float
    coordinate_space: str
    caveat: str = "Candidate requires scientific validation; it is not a confirmed detection."


class AnalyzeResponse(BaseModel):
    status: str
    context_epoch: str
    target_epoch: str
    difference_score: float | None = None
    difference_image_url: str | None = None
    candidates: list[CandidateResponse] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    message: str | None = None
