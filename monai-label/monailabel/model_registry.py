"""Registry metadata for models exposed by the MONAI service.

The registry is intentionally metadata-only: listing models must not import a
model implementation or allocate GPU memory. Providers can later be extended
to route new models to an external gateway without changing the frontend API.
"""

from typing import Any, Dict, List, Optional


_MODEL_REGISTRY = (
    {
        "id": "nnInteractive",
        "display_name": "nnInteractive",
        "provider": "builtin",
        "task": "interactive_segmentation",
        "capabilities": ("point", "scribble", "box"),
        "default": True,
    },
    {
        "id": "sam2",
        "display_name": "SAM2",
        "provider": "builtin",
        "task": "interactive_segmentation",
        "capabilities": ("point", "box"),
    },
    {
        "id": "medsam2",
        "display_name": "MedSAM2",
        "provider": "builtin",
        "task": "interactive_segmentation",
        "capabilities": ("point", "box"),
    },
    {
        "id": "VoxTell",
        "display_name": "VoxTell",
        "provider": "builtin",
        "task": "text_prompt_segmentation",
        "capabilities": ("text",),
        "default": True,
    },
)


def list_models(task: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return serializable copies of registered model metadata."""
    models = _MODEL_REGISTRY
    if task is not None:
        models = tuple(model for model in models if model["task"] == task)

    return [
        {
            **model,
            "capabilities": list(model["capabilities"]),
        }
        for model in models
    ]


def get_model(model_id: str) -> Optional[Dict[str, Any]]:
    """Return a serializable copy of one model, or ``None`` when unknown."""
    for model in list_models():
        if model["id"] == model_id:
            return model
    return None
