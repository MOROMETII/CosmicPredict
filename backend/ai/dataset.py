"""PyTorch dataset for preprocessed observation patches."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import Dataset


class ObservationPatchDataset(Dataset[dict[str, Any]]):
    """Load `.npz` patches and masks produced by ``scripts/preprocess.py``."""

    def __init__(self, manifest_path: str | Path) -> None:
        self.manifest_path = Path(manifest_path)
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        records = payload.get("samples")
        if not isinstance(records, list) or not records:
            raise ValueError("preprocessed manifest contains no samples")
        self.records = records

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> dict[str, Any]:
        record = self.records[index]
        sample_path = self.manifest_path.parent / record["sample_path"]
        with np.load(sample_path) as sample:
            image = torch.from_numpy(sample["image"]).float().unsqueeze(0)
            valid_mask = torch.from_numpy(sample["valid_mask"]).bool()
        return {
            "image": image,
            "valid_mask": valid_mask,
            "source_path": record["source_path"],
            "observation_index": record["observation_index"],
            "row": record["row"],
            "column": record["column"],
        }


class ObservationPairDataset(Dataset[dict[str, Any]]):
    """Load explicitly declared context/target patch pairs.

    Pair records must be created only after validating sky footprint, band or
    channel compatibility, and the intended epoch relationship.
    """

    def __init__(self, pair_manifest_path: str | Path) -> None:
        self.manifest_path = Path(pair_manifest_path)
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        pairs = payload.get("pairs")
        if not isinstance(pairs, list) or not pairs:
            raise ValueError("pair manifest contains no pairs")
        self.pairs = pairs

    def __len__(self) -> int:
        return len(self.pairs)

    def _load_sample(self, relative_path: str) -> tuple[Tensor, Tensor]:
        sample_path = self.manifest_path.parent / relative_path
        with np.load(sample_path) as sample:
            image = torch.from_numpy(sample["image"]).float().unsqueeze(0)
            valid_mask = torch.from_numpy(sample["valid_mask"]).bool()
        return image, valid_mask

    def __getitem__(self, index: int) -> dict[str, Any]:
        record = self.pairs[index]
        context, context_mask = self._load_sample(record["context_sample"])
        target, target_mask = self._load_sample(record["target_sample"])
        if context.shape != target.shape or context_mask.shape != target_mask.shape:
            raise ValueError("context and target pair patches have different shapes")
        return {
            "context": context,
            "target": target,
            "context_valid_mask": context_mask,
            "target_valid_mask": target_mask,
            "context_source_path": record.get("context_source_path"),
            "target_source_path": record.get("target_source_path"),
        }
