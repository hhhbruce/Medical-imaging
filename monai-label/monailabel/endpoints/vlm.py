# Copyright (c) MONAI Consortium
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Endpoints for user-configured (custom) VLM endpoints.

These routes let the front-end ask a remote OpenAI-compatible / Anthropic endpoint
for its model list, given a base URL + API key + endpoint type. Inference itself
runs through the normal ``nninter: custom`` path in ``basic_infer.py``.
"""

import logging

import requests
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from monailabel.config import RBAC_USER, settings
from monailabel.endpoints.user.auth import RBAC, User

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infer/vlm",
    tags=["VLM"],
    responses={404: {"description": "Not found"}},
)

_ENDPOINT_TYPES = ("openai-responses", "openai-chat", "anthropic")


class ListModelsRequest(BaseModel):
    base_url: str = ""
    api_key: str = ""
    endpoint_type: str = "openai-chat"


def _list_models_openai(base_url: str, api_key: str):
    """List model ids and vision capability from an OpenAI-compatible server."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key or "missing", base_url=base_url, timeout=60.0)
    listed = getattr(client.models.list(), "data", None) or []
    model_ids = []
    vision_model_ids = []
    vision_capabilities_known = False
    for model in listed:
        model_id = getattr(model, "id", None)
        if not model_id:
            continue
        model_id = str(model_id)
        model_ids.append(model_id)
        supports_vision = getattr(model, "supports_vision", None)
        if supports_vision is not None:
            vision_capabilities_known = True
            if bool(supports_vision):
                vision_model_ids.append(model_id)
    return model_ids, vision_model_ids, vision_capabilities_known


def _list_models_anthropic(base_url: str, api_key: str):
    """List model ids from an Anthropic-compatible endpoint (``GET {base}/v1/models``)."""
    base = (base_url or "https://api.anthropic.com").rstrip("/")
    headers = {
        "x-api-key": api_key or "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    resp = requests.get(f"{base}/v1/models", headers=headers, timeout=60.0)
    resp.raise_for_status()
    data = resp.json()
    return [str(m.get("id")) for m in data.get("data", []) if m.get("id")]


@router.post(
    "/models",
    summary=f"{RBAC_USER}List models served by a custom VLM endpoint",
)
async def api_list_vlm_models(
    req: ListModelsRequest,
    user: User = Depends(RBAC(settings.MONAI_LABEL_AUTH_ROLE_USER)),
):
    base_url = req.base_url.strip()
    api_key = req.api_key.strip()
    endpoint_type = req.endpoint_type.strip().lower()

    if endpoint_type not in _ENDPOINT_TYPES:
        return {
            "models": [],
            "error": f"invalid endpoint_type; use one of: {', '.join(_ENDPOINT_TYPES)}",
        }
    if not base_url:
        return {"models": [], "error": "base_url is required"}

    try:
        if endpoint_type == "anthropic":
            models = _list_models_anthropic(base_url, api_key)
            return {"models": models, "vision_models": [], "vision_capabilities_known": False, "error": ""}
        models, vision_models, vision_capabilities_known = _list_models_openai(base_url, api_key)
        return {
            "models": models,
            "vision_models": vision_models,
            "vision_capabilities_known": vision_capabilities_known,
            "error": "",
        }
    except Exception as exc:
        logger.exception("Custom VLM model listing failed for %s", base_url)
        return {"models": [], "error": f"{type(exc).__name__}: {exc}"}
