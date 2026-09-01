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

"""Live polling endpoint for multi-agent (MAS) workflow runs.

The viewer POSTs the MAS infer request as usual (synchronous, returns the
final payload). While that request is in flight, the viewer polls this
endpoint with the ``mas_run_id`` it generated to receive the orchestration
events as they happen and render the live agent data-flow popup.
"""

from fastapi import APIRouter, Depends, HTTPException

from monailabel.config import RBAC_USER, settings
from monailabel.endpoints.user.auth import RBAC, User
from monailabel.tasks.infer.mas_inference import mas_run_snapshot

router = APIRouter(prefix="/mas", tags=["MAS"])


@router.get("/runs/{run_id}", summary=f"{RBAC_USER}Poll a running multi-agent workflow")
async def api_mas_run(run_id: str, user: User = Depends(RBAC(settings.MONAI_LABEL_AUTH_ROLE_USER))):
    snapshot = mas_run_snapshot(run_id)
    if snapshot is None:
        # The run may not be registered yet (its POST is still preparing the
        # request). Returning 404 lets the viewer keep polling.
        raise HTTPException(status_code=404, detail=f"Unknown MAS run: {run_id}")
    return snapshot
