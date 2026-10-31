"""Compact ViT-style encoder for SPHEREx-like image arrays.

The encoder deliberately does not normalize or augment image values. Those
operations belong in the data-preparation pipeline so training and inference
can share the same documented preprocessing.
"""

from __future__ import annotations

from typing import TypeAlias

import numpy as np
import torch
from torch import Tensor, nn

ImageArray: TypeAlias = np.ndarray | Tensor


def to_image_tensor(
    image: ImageArray,
    *,
    device: torch.device | str = "cpu",
    dtype: torch.dtype = torch.float32,
) -> Tensor:
    """Convert an image to a batched ``[B, C, H, W]`` tensor.

    Accepted NumPy/tensor shapes are ``[H, W]``, ``[C, H, W]`` and
    ``[B, C, H, W]``. Non-finite values are rejected rather than silently
    becoming model input.
    """

    tensor = image if isinstance(image, Tensor) else torch.from_numpy(np.asarray(image))
    if tensor.ndim == 2:
        tensor = tensor.unsqueeze(0).unsqueeze(0)
    elif tensor.ndim == 3:
        tensor = tensor.unsqueeze(0)
    elif tensor.ndim != 4:
        raise ValueError("image must have shape [H,W], [C,H,W], or [B,C,H,W]")
    if not tensor.is_floating_point():
        tensor = tensor.float()
    tensor = tensor.to(device=device, dtype=dtype)
    if not torch.isfinite(tensor).all():
        raise ValueError("image contains NaN or infinite values")
    if min(tensor.shape[-2:]) < 8:
        raise ValueError("image height and width must each be at least 8 pixels")
    return tensor


class ImageEncoder(nn.Module):
    """A small local-friendly ViT that preserves a spatial latent grid.

    The encoder uses non-overlapping image patches and a short transformer
    stack. It is intentionally trained from scratch: natural-image weights
    should not be assumed to transfer to infrared spectral images.
    """

    def __init__(
        self,
        in_channels: int = 1,
        latent_dim: int = 64,
        base_channels: int = 32,
        patch_size: int = 8,
        depth: int = 4,
        num_heads: int = 4,
    ) -> None:
        super().__init__()
        if in_channels < 1 or latent_dim < 1 or base_channels < 4:
            raise ValueError("channel and feature sizes must be positive")
        if patch_size < 2 or depth < 1 or num_heads < 1:
            raise ValueError("patch_size, depth, and num_heads must be positive")
        embed_dim = base_channels * 3
        if embed_dim % num_heads:
            raise ValueError("base_channels * 3 must be divisible by num_heads")
        self.in_channels = in_channels
        self.latent_dim = latent_dim
        self.patch_size = patch_size
        self.patch_embedding = nn.Conv2d(
            in_channels,
            embed_dim,
            kernel_size=patch_size,
            stride=patch_size,
        )
        layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=embed_dim * 4,
            dropout=0.0,
            activation="gelu",
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(layer, num_layers=depth)
        self.output_projection = nn.Linear(embed_dim, latent_dim)

    def forward(self, image: Tensor) -> Tensor:
        if image.ndim != 4:
            raise ValueError("encoder input must have shape [B,C,H,W]")
        if image.shape[1] != self.in_channels:
            raise ValueError(
                f"encoder expects {self.in_channels} channel(s), got {image.shape[1]}"
            )
        height, width = image.shape[-2:]
        if height % self.patch_size or width % self.patch_size:
            raise ValueError(
                f"image height and width must be divisible by patch_size={self.patch_size}"
            )
        patches = self.patch_embedding(image)
        grid_height, grid_width = patches.shape[-2:]
        tokens = patches.flatten(2).transpose(1, 2)
        tokens = self.transformer(tokens)
        tokens = self.output_projection(tokens)
        return tokens.transpose(1, 2).reshape(
            image.shape[0], self.latent_dim, grid_height, grid_width
        )
