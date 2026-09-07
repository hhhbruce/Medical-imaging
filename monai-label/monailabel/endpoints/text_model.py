"""On-demand load + status endpoints for text-prompt segmentation models.

Text-prompt models (VoxTell + its Qwen3-Embedding-4B text backbone) are large and
are intentionally NOT loaded at server boot (LOAD_VOXTELL defaults to lazy). The
frontend workflow is:

    1. GET  /models/?task=text_prompt_segmentation   (populate the model dropdown)
    2. POST /text/model/{model}/load                 (start loading, returns at once)
    3. GET  /text/model/{model}/status               (poll until state == "ready")

The load itself runs in a daemon thread so the POST never blocks on the
multi-minute model load; the state machine lives in basic_infer and is shared
with the inference path, so a first-use load triggered by an inference request
is reported through the same status API.

Plain `def` handlers so FastAPI runs them in its threadpool.
"""

import logging
import threading

from fastapi import APIRouter, HTTPException

from monailabel.model_registry import list_models
from monailabel.tasks.infer import basic_infer

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/text/model",
    tags=["Text Model"],
    responses={404: {"description": "Not found"}},
)


def _require_text_model(model: str) -> None:
    """Validate that ``model`` is a registered text-prompt segmentation model."""
    if model not in {
        spec["id"] for spec in list_models(task="text_prompt_segmentation")
    }:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown text prompt segmentation model: {model}",
        )


@router.get("/", summary="List text-prompt segmentation models with their load state")
def list_text_models_with_status():
    models = []
    for spec in list_models(task="text_prompt_segmentation"):
        status = basic_infer.text_model_status(spec["id"])
        models.append({**spec, **status})
    return {"models": models}


@router.get("/{model}/status", summary="Report the load state of one text-prompt model")
def get_text_model_status(model: str):
    _require_text_model(model)
    status = basic_infer.text_model_status(model)
    spec = next(
        (s for s in list_models(task="text_prompt_segmentation") if s["id"] == model),
        None,
    )
    return {"model": model, "task": spec["task"] if spec else None, **status}


@router.post("/{model}/load", summary="Start loading a text-prompt model (returns immediately)")
def load_text_model(model: str):
    """Kick off (or join) the load of ``model``.

    Returns at once with the current state; the caller polls
    ``GET /text/model/{model}/status`` until it reaches ``ready``/``error``.
    Idempotent: an already-loading or already-ready model is never reloaded.
    """
    _require_text_model(model)
    status = basic_infer.text_model_status(model)

    if status["state"] == "ready":
        return {"model": model, "action": "already_ready", **status}
    if status["state"] == "loading":
        return {"model": model, "action": "already_loading", **status}

    # Flip to loading synchronously so the first status poll (which may arrive
    # before the worker thread runs) never sees the stale "idle" state.
    basic_infer.text_model_load_begin(model)

    def _worker() -> None:
        try:
            basic_infer.text_model_load(model)
        except Exception as error:  # noqa: BLE001 - state already records the failure
            logger.error("Text model %s load worker failed: %s", model, error)

    threading.Thread(
        target=_worker,
        name=f"text-model-load-{model}",
        daemon=True,
    ).start()

    return {"model": model, "action": "loading", **basic_infer.text_model_status(model)}
