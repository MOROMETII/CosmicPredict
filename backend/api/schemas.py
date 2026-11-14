"""Stable frontend-facing API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ObservationResponse(BaseModel):
    observation_id: str
    epoch: datetime | None
    band: str | None
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


class AnalyzeRequest(BaseModel):
    context_epoch: str
    target_epoch: str
    band: str | None = None
    row: int = Field(default=0, ge=0)
    column: int = Field(default=0, ge=0)
    size: int = Field(default=128, ge=8, le=1024, multiple_of=8)
    run_jepa: bool = False


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
    jepa_score: float | None = None
    score_kind: str | None = None
    anomaly_map: list[list[float]] | None = None
    difference_image_url: str | None = None
    jepa_status: str = "not_requested"
    candidates: list[CandidateResponse] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    message: str | None = None
