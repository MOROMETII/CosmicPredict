"""Latent prediction model and training helpers."""

from __future__ import annotations

from copy import deepcopy

import torch
from torch import Tensor, nn

from .encoder import ImageEncoder


def masked_mse(
    predicted: Tensor,
    target: Tensor,
    valid_mask: Tensor | None = None,
) -> Tensor:
    """Return mean squared error over valid spatial locations."""

    if predicted.shape != target.shape:
        raise ValueError("predicted and target latent tensors must have equal shape")
    error = (predicted - target).square()
    if valid_mask is None:
        return error.mean()
    mask = valid_mask
    if mask.ndim == 3:
        mask = mask.unsqueeze(1)
    if mask.ndim != 4 or mask.shape[0] != error.shape[0] or mask.shape[-2:] != error.shape[-2:]:
        raise ValueError("valid_mask must have shape [B,H,W] or [B,1,H,W]")
    mask = mask.to(device=error.device, dtype=torch.bool).expand_as(error)
    valid_values = error[mask]
    if valid_values.numel() == 0:
        raise ValueError("valid_mask contains no valid latent locations")
    return valid_values.mean()


class LatentPredictor(nn.Module):
    """Predict target latent features from a context latent feature map."""

    def __init__(self, latent_dim: int = 64, hidden_dim: int = 128) -> None:
        super().__init__()
        if latent_dim < 1 or hidden_dim < 1:
            raise ValueError("latent and hidden dimensions must be positive")
        self.latent_dim = latent_dim
        self.network = nn.Sequential(
            nn.Conv2d(latent_dim, hidden_dim, kernel_size=1),
            nn.GELU(),
            nn.Conv2d(hidden_dim, hidden_dim, kernel_size=1),
            nn.GELU(),
            nn.Conv2d(hidden_dim, latent_dim, kernel_size=1),
        )

    def forward(self, context_latent: Tensor) -> Tensor:
        if context_latent.ndim != 4 or context_latent.shape[1] != self.latent_dim:
            raise ValueError("context latent has an incompatible shape")
        return self.network(context_latent)


class JEPARepresentationModel(nn.Module):
    """Context encoder, frozen target encoder, and latent predictor.

    The target encoder is initialized from the context encoder and updated with
    an exponential moving average, which keeps target representations stable
    without requiring a second supervised label.
    """

    def __init__(
        self,
        *,
        in_channels: int = 1,
        latent_dim: int = 64,
        base_channels: int = 32,
        predictor_hidden_dim: int = 128,
    ) -> None:
        super().__init__()
        self.context_encoder = ImageEncoder(in_channels, latent_dim, base_channels)
        self.target_encoder = deepcopy(self.context_encoder)
        self.predictor = LatentPredictor(latent_dim, predictor_hidden_dim)
        for parameter in self.target_encoder.parameters():
            parameter.requires_grad_(False)

    def encode_context(self, image: Tensor) -> Tensor:
        return self.context_encoder(image)

    @torch.no_grad()
    def encode_target(self, image: Tensor) -> Tensor:
        return self.target_encoder(image)

    def predict(self, context_image: Tensor) -> Tensor:
        return self.predictor(self.encode_context(context_image))

    def forward(self, context_image: Tensor, target_image: Tensor) -> tuple[Tensor, Tensor]:
        return self.predict(context_image), self.encode_target(target_image)

    def loss(
        self,
        context_image: Tensor,
        target_image: Tensor,
        valid_mask: Tensor | None = None,
    ) -> Tensor:
        predicted, target = self(context_image, target_image)
        return masked_mse(predicted, target, valid_mask)

    @torch.no_grad()
    def update_target_encoder(self, momentum: float = 0.996) -> None:
        if not 0.0 <= momentum < 1.0:
            raise ValueError("momentum must be in the range [0, 1)")
        for context_parameter, target_parameter in zip(
            self.context_encoder.parameters(), self.target_encoder.parameters()
        ):
            target_parameter.mul_(momentum).add_(context_parameter, alpha=1.0 - momentum)
