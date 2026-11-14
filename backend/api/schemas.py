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


class GaiaMatchResponse(BaseModel):
    """The nearest catalogued Gaia DR3 star to a candidate, when one exists."""

    source_id: str
    separation_arcsec: float
    g_mag: float | None = None
    pm_total_mas_yr: float | None = None
    parallax_mas: float | None = None
    variable_flag: str | None = None


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
    ra: float | None = None  # WCS-derived sky coordinates of the candidate center
    dec: float | None = None
    gaia_match: GaiaMatchResponse | None = None
    gaia_checked: bool = False  # False: cross-match unavailable, absence of a match means nothing
    interpretation: str | None = None
    caveat: str = "Candidate requires scientific validation; it is not a confirmed detection."


class GaiaSourceResponse(BaseModel):
    source_id: str
    ra: float
    dec: float
    g_mag: float | None = None
    pm_total_mas_yr: float | None = None
    variable_flag: str | None = None
    # Fractional position inside the requested cutout frame (0-1, from the
    # shared aligned grid WCS), so the frontend can overlay without sky math.
    x_frac: float
    y_frac: float


class GaiaOverlayResponse(BaseModel):
    """Catalogued Gaia DR3 stars inside an aligned cutout frame."""

    status: str
    ra: float
    dec: float
    fov_arcmin: float
    sources: list[GaiaSourceResponse] = Field(default_factory=list)
    provenance: dict[str, Any] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    message: str | None = None


class FeedItem(BaseModel):
    """One scrollable tile: a real sky position with a verified multi-epoch series."""

    ra: float
    dec: float
    fov_arcmin: float
    band: str | None = None
    n_frames: int
    region_key: str  # which cached region this tile belongs to


class FeedResponse(BaseModel):
    status: str
    items: list[FeedItem] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    message: str | None = None


class MarkCreateRequest(BaseModel):
    """Flag a view (and optionally a tapped spot inside it) as suspicious."""

    ra: float = Field(..., ge=0, lt=360)
    dec: float = Field(..., ge=-90, le=90)
    fov_arcmin: float = Field(default=15.0, ge=0.5, le=240.0)
    band: str | None = Field(default=None, max_length=16)
    observation_id: str | None = Field(default=None, max_length=128)
    epoch: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=500)
    source: str = Field(default="scroll", max_length=32)
    # Fractional position of the tapped spot inside the displayed frame.
    x_frac: float | None = Field(default=None, ge=0.0, le=1.0)
    y_frac: float | None = Field(default=None, ge=0.0, le=1.0)


class MarkResponse(BaseModel):
    id: str
    created_at: str
    ra: float
    dec: float
    spot_ra: float | None = None  # WCS-derived sky coordinates of the tapped spot
    spot_dec: float | None = None
    fov_arcmin: float
    band: str | None = None
    observation_id: str | None = None
    epoch: str | None = None
    note: str | None = None
    source: str = "scroll"
    preview_url: str | None = None
    caveat: str = "A flag is a personal bookmark for review — not a detection or a confirmed anomaly."


class MarksResponse(BaseModel):
    status: str
    marks: list[MarkResponse] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


class CommentCreateRequest(BaseModel):
    """Post a comment on a sky region (the Sky Scroll reels)."""

    region_key: str = Field(..., max_length=64)
    author: str | None = Field(default=None, max_length=64)
    body: str = Field(..., min_length=1, max_length=2000)


class CommentResponse(BaseModel):
    id: str
    region_key: str
    author: str
    body: str
    created_at: str


class CommentsResponse(BaseModel):
    status: str
    region_key: str
    comments: list[CommentResponse] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    status: str
    context_epoch: str
    target_epoch: str
    difference_score: float | None = None
    difference_image_url: str | None = None
    candidates: list[CandidateResponse] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    message: str | None = None
