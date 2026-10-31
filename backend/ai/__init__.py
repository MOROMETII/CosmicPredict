"""Optional JEPA-inspired representation learning components."""

from .anomaly_score import AnomalyScore, compute_anomaly_score
from .dataset import ObservationPairDataset, ObservationPatchDataset
from .encoder import ImageEncoder, to_image_tensor
from .inference import InferenceResult, JEPAInference
from .predictor import JEPARepresentationModel, LatentPredictor

__all__ = [
    "AnomalyScore",
    "ImageEncoder",
    "InferenceResult",
    "JEPAInference",
    "JEPARepresentationModel",
    "LatentPredictor",
    "ObservationPatchDataset",
    "ObservationPairDataset",
    "compute_anomaly_score",
    "to_image_tensor",
]
