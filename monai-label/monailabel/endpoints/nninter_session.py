"""Claim/release endpoints for the in-process nnInteractive session pool.

Plain `def` (not `async def`) so FastAPI runs them in its threadpool:
claim() constructs a GPU-backed session and must not block the event loop.
Release is POST (not DELETE) because navigator.sendBeacon can only POST.
"""

import logging

from fastapi import APIRouter, HTTPException

from monailabel.model_registry import get_model
from monailabel.tasks.infer import nninter_session_pool

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/nninter/session",
    tags=["Infer"],
    responses={404: {"description": "Not found"}},
)

model_router = APIRouter(
    prefix="/nninter/model",
    tags=["Infer"],
    responses={404: {"description": "Not found"}},
)


@router.post("/", summary="Claim an nnInteractive session (evicts the LRU session when full)")
def claim_session():
    pool = nninter_session_pool.get_pool()
    entry = pool.claim()
    return {"token": entry.token, "idle_timeout": pool.idle_timeout}


@router.post("/{token}/release", summary="Release an nnInteractive session (idempotent)")
def release_session(token: str):
    nninter_session_pool.get_pool().release(token)
    return {"released": True}


@model_router.post("/{model}/load", summary="Load an interactive segmentation model and confirm readiness")
def load_interactive_model(model: str):
    model_spec = get_model(model)
    if not model_spec or model_spec["task"] != "interactive_segmentation":
        raise HTTPException(status_code=400, detail=f"Unsupported interactive segmentation model: {model}")

    try:
        # Import inside the request to avoid changing module initialization order.
        # The inference module owns the actual cached GPU model instances.
        from monailabel.tasks.infer.basic_infer import ensure_interactive_model_ready

        return ensure_interactive_model_ready(model)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        logger.exception("Failed to load interactive segmentation model %s", model)
        raise HTTPException(status_code=503, detail=f"Failed to load {model}: {error}") from error
