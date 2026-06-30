"""
Per-experiment chat conversations — mirrors routers/experiment/notes.py.

v0.40.0 TL source ships a `notes` router but no `conversations` one. NQRust-LLMOps
needs server-side chat history (so it's not stuck in one browser's localStorage),
so we add this router following the exact same pattern: store each conversation as
a JSON file under <experiment_dir>/conversations/<id>.json via the `storage` API,
guard writes with the same permission dependency.

Installed by scripts/setup/apply-conversations.sh (copies this file + registers the
router in experiment.py). Like the sandbox patch, this is a local addition to the
vendored TL source — re-run the script after a TL re-clone.
"""

import json
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException
from werkzeug.utils import secure_filename

from lab import Experiment, storage
from transformerlab.services.permission_service import require_permission

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _conversations_dir(experimentId: str) -> str:
    exp_obj = Experiment(experimentId)
    return storage.join(await exp_obj.get_dir(), "conversations")


@router.get("")
async def list_conversations(experimentId: str):
    """All saved conversations for an experiment, newest first (by updatedAt)."""
    convdir = await _conversations_dir(experimentId)
    out: list = []
    if await storage.exists(convdir):
        for entry in await storage.ls(convdir):
            path = entry["name"] if isinstance(entry, dict) else entry
            if not str(path).endswith(".json"):
                continue
            try:
                async with await storage.open(path, "r", encoding="utf-8") as f:
                    out.append(json.loads(await f.read()))
            except Exception:
                continue
    out.sort(key=lambda c: c.get("updatedAt", "") if isinstance(c, dict) else "", reverse=True)
    return out


@router.post("")
async def save_conversation(
    experimentId: str,
    conversation: Annotated[dict, Body()],
    _: None = Depends(require_permission("experiment", "write", id_param="experimentId")),
):
    """Create or update one conversation, keyed by its `id`."""
    cid = secure_filename(str(conversation.get("id") or ""))
    if not cid:
        raise HTTPException(status_code=400, detail="conversation id is required")
    convdir = await _conversations_dir(experimentId)
    await storage.makedirs(convdir, exist_ok=True)
    async with await storage.open(storage.join(convdir, f"{cid}.json"), "w", encoding="utf-8") as f:
        await f.write(json.dumps(conversation))
    return {"message": "OK", "id": cid}


@router.delete("/{conversation_id}")
async def delete_conversation(
    experimentId: str,
    conversation_id: str,
    _: None = Depends(require_permission("experiment", "write", id_param="experimentId")),
):
    cid = secure_filename(conversation_id)
    if not cid:
        raise HTTPException(status_code=400, detail="Invalid conversation id")
    path = storage.join(await _conversations_dir(experimentId), f"{cid}.json")
    if await storage.exists(path):
        await storage.rm(path)
    return {"message": "OK"}
