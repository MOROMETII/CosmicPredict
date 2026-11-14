"""Latent prediction-error scoring.

Scores are raw latent mean-squared errors, not probabilities. This keeps the
experimental signal interpretable and avoids implying calibration that has not
yet been evaluated on held-out SPHEREx observations.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
from torch import Tensor

from .predictor import masked_mse


@dataclass(frozen=True)
class AnomalyScore:
    """Spatial JEPA-inspired score and aggregate values."""

    anomaly_map: Tensor
    mean_score: float
    max_score: float
    valid_fraction: float
    score_kind: str = "raw_latent_mean_squared_error"


def compute_anomaly_score(
    predicted: Tensor,
    target: Tensor,
    valid_mask: Tensor | None = None,
) -> AnomalyScore:
    """Compute per-location and aggregate prediction error."""

    if predicted.shape != target.shape or predicted.ndim != 4:
        raise ValueError("latent tensors must have equal shape [B,C,H,W]")
    error_map = (predicted - target).square().mean(dim=1)
    if valid_mask is None:
        valid = torch.ones_like(error_map, dtype=torch.bool)
    else:
        valid = valid_mask
        if valid.ndim == 4 and valid.shape[1] == 1:
            valid = valid[:, 0]
        if valid.ndim != 3 or valid.shape != error_map.shape:
            raise ValueError("valid_mask must have shape [B,H,W] or [B,1,H,W]")
        valid = valid.to(device=error_map.device, dtype=torch.bool)
    values = error_map[valid]
    if values.numel() == 0:
        raise ValueError("valid_mask contains no valid locations")
    masked_map = torch.where(valid, error_map, torch.full_like(error_map, torch.nan))
    return AnomalyScore(
        anomaly_map=masked_map,
        mean_score=float(masked_mse(predicted, target, valid_mask).detach().cpu()),
        max_score=float(values.max().detach().cpu()),
        valid_fraction=float(valid.float().mean().detach().cpu()),
    )
