"""Optional checkpoint-backed JEPA-inspired inference."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

from .anomaly_score import compute_anomaly_score
from .encoder import ImageArray, to_image_tensor
from .predictor import JEPARepresentationModel


@dataclass(frozen=True)
class InferenceResult:
    """Inference output with an explicit unavailable state."""

    status: str
    jepa_score: float | None
    anomaly_map: np.ndarray | None
    message: str | None
    score_kind: str | None


class JEPAInference:
    """Run optional model inference without blocking the core application."""

    def __init__(
        self,
        model: JEPARepresentationModel | None,
        *,
        device: torch.device | str = "cpu",
    ) -> None:
        self.device = torch.device(device)
        self.model = model.to(self.device).eval() if model is not None else None

    @classmethod
    def unavailable(cls, message: str = "No JEPA checkpoint is configured") -> "JEPAInference":
        instance = cls(None)
        instance._unavailable_message = message
        return instance

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint_path: str | Path,
        *,
        in_channels: int = 1,
        latent_dim: int = 64,
        base_channels: int = 32,
        predictor_hidden_dim: int = 128,
        device: torch.device | str = "cpu",
    ) -> "JEPAInference":
        path = Path(checkpoint_path)
        if not path.is_file():
            raise FileNotFoundError(f"JEPA checkpoint does not exist: {path}")
        checkpoint = torch.load(path, map_location=device, weights_only=True)
        state_dict = checkpoint.get("model_state_dict", checkpoint) if isinstance(checkpoint, dict) else None
        if not isinstance(state_dict, dict):
            raise ValueError("JEPA checkpoint must contain a model state dictionary")
        architecture = checkpoint.get("architecture", {}) if isinstance(checkpoint, dict) else {}
        if not isinstance(architecture, dict):
            raise ValueError("JEPA checkpoint architecture metadata must be an object")
        model = JEPARepresentationModel(
            in_channels=int(architecture.get("in_channels", in_channels)),
            latent_dim=int(architecture.get("latent_dim", latent_dim)),
            base_channels=int(architecture.get("base_channels", base_channels)),
            predictor_hidden_dim=int(
                architecture.get("predictor_hidden_dim", predictor_hidden_dim)
            ),
        )
        model.load_state_dict(state_dict)
        return cls(model, device=device)

    @torch.no_grad()
    def run(
        self,
        context_image: ImageArray,
        target_image: ImageArray,
        valid_mask: np.ndarray | torch.Tensor | None = None,
    ) -> InferenceResult:
        if self.model is None:
            return InferenceResult(
                status="unavailable",
                jepa_score=None,
                anomaly_map=None,
                message=getattr(self, "_unavailable_message", "JEPA inference is unavailable"),
                score_kind=None,
            )
        context = to_image_tensor(context_image, device=self.device)
        target = to_image_tensor(target_image, device=self.device)
        if context.shape != target.shape:
            raise ValueError("context and target images must have equal shape")
        mask = None
        if valid_mask is not None:
            mask = torch.as_tensor(valid_mask, device=self.device, dtype=torch.bool)
        predicted, target_latent = self.model(context, target)
        score = compute_anomaly_score(predicted, target_latent, mask)
        return InferenceResult(
            status="ok",
            jepa_score=score.mean_score,
            anomaly_map=score.anomaly_map.detach().cpu().numpy(),
            message=None,
            score_kind=score.score_kind,
        )
