"""Model registry API.

This endpoint exposes model metadata without importing model implementations.
The frontend can therefore discover available models while the backend keeps
model loading and provider selection private.
"""

from typing import Optional

from fastapi import APIRouter

from monailabel.model_registry import list_models

router = APIRouter(
    prefix="/models",
    tags=["Model Registry"],
    responses={404: {"description": "Not found"}},
)


@router.get("/", summary="List registered models")
def api_list_models(task: Optional[str] = None):
    return {"models": list_models(task=task)}
