#!/usr/bin/env python3
"""RantAI decision server — serves decision models (System One / Jev-style typed decisions).

A decision model reads a `state` and answers typed questions (noul = yes/no, choice, score) with a
calibrated probability. It is not a text generator, so neither vLLM nor Ollama can serve it; this
process loads it with Unsloth's `FastDecisionModel` (PyTorch) and exposes the Decision API:

    POST /v1/systemone     {"model", "state", "questions"}  ->  {"model", "answers", "usage"}
    GET  /v1/models        the loaded models
    GET  /health           liveness + which models are loaded (no auth)

The request and answer shapes are those of Unsloth Studio's `/v1/systemone`, so a client written for
one works against the other. Models are added and removed WITHOUT a restart through the admin API
(`X-Admin-Token`), which is how the LLMOps UI deploys a finished decision job:

    GET    /admin/models
    POST   /admin/models        {"name", "path", "load_in_4bit"?, "max_seq_length"?}
    DELETE /admin/models/{name}

and the set is remembered in DECISION_STATE_FILE, so a restart brings the same models back.

There is NO caller authentication here: this is meant to sit behind rantai-gateway (an API key and a
model allowlist), on the internal docker network, like vLLM. The admin API is separate and disabled
unless DECISION_ADMIN_TOKEN is set.

Config (env):
  DECISION_PORT           listen port (8000)
  DECISION_MODELS         JSON list of {"name", "path", "load_in_4bit"?} to load at start
  DECISION_STATE_FILE     where the served set is remembered (/data/decision-models.json)
  DECISION_ADMIN_TOKEN    enables the admin API
  DECISION_MODEL_ROOTS    ":"-separated directories a model path must live under (/root/.transformerlab)
  DECISION_MAX_MODELS     how many models may be loaded at once (3); each holds GPU memory
  DECISION_MAX_STATE_CHARS  longest accepted state (200000)
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # decision_schema.py is copied beside this file
from decision_schema import validate_questions  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.encoders import jsonable_encoder  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

log = logging.getLogger("decision")

NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
REQUEST_FIELDS = {"model", "state", "questions", "images", "audio"}
# A model folder is a Clef adapter or merged model (joint_head_config.json) or a Laya one.
MODEL_MARKERS = ("joint_head_config.json", "rl_agent_config.json")


class ServerError(Exception):
    """An error with an HTTP status and an OpenAI-style type, raised anywhere and mapped once."""

    def __init__(self, status: int, message: str, kind: str):
        super().__init__(message)
        self.status, self.message, self.kind = status, message, kind


# ─────────────────────────────── loading and predicting ───────────────────────────────


def unsloth_loader(path: str, load_in_4bit: bool, max_seq_length: int):
    from unsloth import FastDecisionModel

    model, processor = FastDecisionModel.from_pretrained(
        path, max_seq_length=max_seq_length, load_in_4bit=load_in_4bit
    )
    FastDecisionModel.for_inference(model)
    # The first prediction compiles kernels (measured 20 s on the GB10 against ~50 ms afterwards).
    # Pay that here, at load time, instead of in the first caller's request.
    try:
        FastDecisionModel.predict(model, processor, "warm-up", {"w": {"type": "noul"}})
    except Exception as e:  # noqa: BLE001 - a failed warm-up only means the first request is slow
        log.warning("warm-up prediction failed: %s", e)
    return model, processor


def unsloth_predictor(model, processor, state, questions) -> dict:
    from unsloth import FastDecisionModel

    return FastDecisionModel.predict(model, processor, state, questions)


def unsloth_free() -> None:
    try:
        import gc

        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001 - freeing memory is best-effort
        pass


class Served:
    """One loaded model. The lock exists because a PyTorch model is not safe to call from two threads."""

    def __init__(self, name: str, path: str, load_in_4bit: bool, max_seq_length: int):
        self.name, self.path = name, path
        self.load_in_4bit, self.max_seq_length = load_in_4bit, max_seq_length
        self.model: Any = None
        self.processor: Any = None
        self.loaded_at: float | None = None
        self.error: str | None = None
        self.lock = threading.Lock()

    def describe(self) -> dict:
        return {
            "name": self.name,
            "path": self.path,
            "loaded": self.model is not None,
            "error": self.error,
            "load_in_4bit": self.load_in_4bit,
            "max_seq_length": self.max_seq_length,
            "loaded_at": self.loaded_at,
        }


class Registry:
    def __init__(self, loader=unsloth_loader, predictor=unsloth_predictor, free=unsloth_free,
                 state_file: str | None = None, roots: list[str] | None = None, max_models: int = 3):
        self.loader, self.predictor, self.free = loader, predictor, free
        self.state_file = state_file
        self.roots = [Path(r).resolve() for r in (roots if roots is not None else ["/root/.transformerlab"])]
        self.max_models = max_models
        self.models: dict[str, Served] = {}
        self._mutex = threading.Lock()  # guards the dict and the state file, never held while loading
        self._loading: set[str] = set()
        self.ready = False

    # -- paths ---------------------------------------------------------------------------
    def resolve_path(self, path: str) -> str:
        """A model folder under an allowed root that holds a decision model. Anything else is refused:
        the admin API must not be a way to make the server read an arbitrary directory."""
        try:
            p = Path(path).resolve()
        except (OSError, ValueError) as e:
            raise ServerError(400, f"invalid path: {e}", "invalid_path") from e
        if not any(p == r or r in p.parents for r in self.roots):
            raise ServerError(400, "the model path is outside the allowed model roots", "invalid_path")
        if not p.is_dir() or not any((p / m).is_file() for m in MODEL_MARKERS):
            raise ServerError(400, "the path is not a decision model folder (no joint_head_config.json)", "invalid_path")
        return str(p)

    # -- state ---------------------------------------------------------------------------
    def _persist(self) -> None:
        if not self.state_file:
            return
        entries = [
            {"name": s.name, "path": s.path, "load_in_4bit": s.load_in_4bit, "max_seq_length": s.max_seq_length}
            for s in self.models.values()
        ]
        tmp = f"{self.state_file}.tmp"
        try:
            os.makedirs(os.path.dirname(self.state_file) or ".", exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(entries, f, indent=2)
            os.replace(tmp, self.state_file)
        except OSError as e:
            log.warning("could not save %s: %s", self.state_file, e)

    def entries_from_disk(self) -> list[dict]:
        if not self.state_file or not os.path.isfile(self.state_file):
            return []
        try:
            with open(self.state_file, encoding="utf-8") as f:
                data = json.load(f)
            return [e for e in data if isinstance(e, dict) and e.get("name") and e.get("path")]
        except (OSError, ValueError):
            log.warning("ignoring unreadable %s", self.state_file)
            return []

    # -- operations ----------------------------------------------------------------------
    def load(self, name: str, path: str, load_in_4bit: bool = False, max_seq_length: int = 4096,
             persist: bool = True) -> Served:
        if not NAME_RE.match(name or ""):
            raise ServerError(400, "name must be 1-64 characters of letters, digits, . _ -", "invalid_name")
        if not 256 <= int(max_seq_length) <= 65536:
            raise ServerError(400, "max_seq_length must be between 256 and 65536", "invalid_request")
        real = self.resolve_path(path)
        with self._mutex:
            if name in self.models or name in self._loading:
                raise ServerError(409, f"a model named '{name}' is already served", "conflict")
            if len(self.models) + len(self._loading) >= self.max_models:
                raise ServerError(409, f"at most {self.max_models} models can be loaded at once", "conflict")
            self._loading.add(name)
        served = Served(name, real, bool(load_in_4bit), int(max_seq_length))
        try:
            served.model, served.processor = self.loader(real, served.load_in_4bit, served.max_seq_length)
            served.loaded_at = time.time()
        except Exception as e:  # noqa: BLE001
            with self._mutex:
                self._loading.discard(name)
            raise ServerError(500, f"could not load the model: {e}", "load_failed") from e
        with self._mutex:
            self._loading.discard(name)
            self.models[name] = served
            if persist:
                self._persist()
        return served

    def unload(self, name: str) -> None:
        with self._mutex:
            served = self.models.pop(name, None)
            if served is None:
                raise ServerError(404, f"model '{name}' is not served", "model_not_found")
            self._persist()
        with served.lock:  # wait for a prediction in flight
            served.model = served.processor = None
        self.free()

    def get(self, name: str) -> Served | None:
        return self.models.get(name)

    def restore(self, extra: list[dict] | None = None) -> None:
        """Load the remembered models plus any given at start. A model that fails is logged and
        skipped, never fatal: one broken entry must not keep the others from being served."""
        seen = set()
        for entry in [*self.entries_from_disk(), *(extra or [])]:
            name = entry.get("name")
            if name in seen:
                continue
            seen.add(name)
            try:
                self.load(name, entry["path"], bool(entry.get("load_in_4bit", False)),
                          int(entry.get("max_seq_length", 4096)), persist=False)
                log.info("loaded %s", name)
            except ServerError as e:
                log.error("could not restore %s: %s", name, e.message)
        self._persist()
        self.ready = True


# ─────────────────────────────────────── app ───────────────────────────────────────────


def _error(status: int, message: str, kind: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"message": message, "type": kind}})


def _input_tokens(served: Served, state: Any) -> int:
    try:
        text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
        tok = getattr(served.processor, "tokenizer", served.processor)
        return len(tok.encode(text))
    except Exception:  # noqa: BLE001 - usage is informational
        return 0


def create_app(registry: Registry, admin_token: str = "", max_state_chars: int = 200_000,
               startup_models: list[dict] | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # Loading can take minutes for an 8B model; run it off the event loop so /health answers meanwhile.
        threading.Thread(target=registry.restore, args=(startup_models,), daemon=True).start()
        yield

    app = FastAPI(title="RantAI decision server", lifespan=lifespan)

    @app.exception_handler(ServerError)
    async def _server_error(_: Request, exc: ServerError):
        return _error(exc.status, exc.message, exc.kind)

    def require_admin(request: Request) -> None:
        if not admin_token:
            raise ServerError(403, "the admin API is disabled (DECISION_ADMIN_TOKEN is not set)", "admin_disabled")
        given = request.headers.get("x-admin-token", "")
        if not hmac.compare_digest(given.encode(), admin_token.encode()):
            raise ServerError(401, "invalid or missing admin token", "auth")

    @app.get("/health")
    @app.get("/healthz")
    @app.get("/")
    async def health():
        return {"status": "ok", "service": "rantai-decision", "ready": registry.ready,
                "models": sorted(m for m, s in registry.models.items() if s.model is not None)}

    @app.get("/v1/models")
    async def models():
        return {"object": "list", "data": [
            {"id": n, "object": "model", "owned_by": "rantai", "created": int(s.loaded_at or 0)}
            for n, s in sorted(registry.models.items()) if s.model is not None
        ]}

    @app.post("/v1/systemone")
    async def systemone(request: Request):
        try:
            body = await request.json()
        except ValueError:
            raise ServerError(400, "the body is not valid JSON", "invalid_request") from None
        if not isinstance(body, dict):
            raise ServerError(422, "the body must be a JSON object", "invalid_request")
        unknown = sorted(set(body) - REQUEST_FIELDS)
        if unknown:
            raise ServerError(422, f"unknown field(s): {', '.join(unknown)}", "invalid_request")
        if body.get("images") or body.get("audio"):
            raise ServerError(422, "this server answers from text only: images and audio are not supported",
                              "invalid_request")
        name = body.get("model")
        if not isinstance(name, str) or not name:
            raise ServerError(422, "`model` is required", "invalid_request")
        state = body.get("state")
        empty = state is None or state == "" or state == {} or state == [] or (isinstance(state, str) and not state.strip())
        if empty or not isinstance(state, (str, dict, list)):
            raise ServerError(422, "`state` must be non-empty text or JSON", "invalid_request")
        size = len(state) if isinstance(state, str) else len(json.dumps(state, ensure_ascii=False))
        if size > max_state_chars:
            raise ServerError(422, f"`state` is {size} characters, at most {max_state_chars} are accepted", "invalid_request")
        questions = body.get("questions")
        problems = validate_questions(questions)
        if problems:
            raise ServerError(422, "; ".join(problems[:5]), "invalid_request")
        served = registry.get(name)
        if served is None or served.model is None:
            raise ServerError(404, f"model '{name}' is not served", "model_not_found")

        def run():
            with served.lock:
                if served.model is None:  # unloaded while this request waited for the lock
                    raise ServerError(404, f"model '{name}' is not served", "model_not_found")
                return registry.predictor(served.model, served.processor, state, questions)

        try:
            answers = await run_in_threadpool(run)
        except ServerError:
            raise
        except Exception as e:  # noqa: BLE001
            # Unsloth raises DecisionDataError (a ValueError) for input it cannot use, e.g. options that
            # do not fit the context. That is the caller's problem; anything else is ours.
            if type(e).__name__ == "DecisionDataError":
                raise ServerError(422, str(e), "invalid_request") from e
            log.exception("prediction failed")
            raise ServerError(500, f"prediction failed: {e}", "internal_error") from e
        content = {"model": name, "answers": answers,
                   "usage": {"input_tokens": _input_tokens(served, state), "output_tokens": 0}}
        return JSONResponse(content=jsonable_encoder(content, custom_encoder={_np_generic(): lambda o: o.item()}),
                            headers={"x-decision-backend": "pytorch"})

    # ── admin ──
    @app.get("/admin/models")
    async def admin_list(request: Request):
        require_admin(request)
        return {"models": [s.describe() for s in registry.models.values()], "max_models": registry.max_models}

    @app.post("/admin/models")
    async def admin_load(request: Request):
        require_admin(request)
        try:
            body = await request.json()
        except ValueError:
            raise ServerError(400, "the body is not valid JSON", "invalid_request") from None
        if not isinstance(body, dict) or not isinstance(body.get("name"), str) or not isinstance(body.get("path"), str):
            raise ServerError(422, "`name` and `path` are required strings", "invalid_request")
        served = await run_in_threadpool(
            registry.load, body["name"], body["path"], bool(body.get("load_in_4bit", False)),
            int(body.get("max_seq_length", 4096)),
        )
        return JSONResponse(status_code=201, content=served.describe())

    @app.delete("/admin/models/{name}")
    async def admin_unload(name: str, request: Request):
        require_admin(request)
        await run_in_threadpool(registry.unload, name)
        return {"unloaded": name}

    return app


def _np_generic():
    try:
        import numpy as np

        return np.generic
    except ImportError:  # numpy is a torch dependency; without it there is nothing to encode
        return type("_Never", (), {})


def build_from_env() -> FastAPI:
    logging.basicConfig(level=os.getenv("DECISION_LOG", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    registry = Registry(
        state_file=os.getenv("DECISION_STATE_FILE", "/data/decision-models.json"),
        roots=[r for r in os.getenv("DECISION_MODEL_ROOTS", "/root/.transformerlab").split(":") if r],
        max_models=int(os.getenv("DECISION_MAX_MODELS", "3")),
    )
    startup = []
    raw = os.getenv("DECISION_MODELS", "").strip()
    if raw:
        try:
            startup = json.loads(raw)
        except ValueError:
            log.error("DECISION_MODELS is not valid JSON; ignored")
    return create_app(registry, admin_token=os.getenv("DECISION_ADMIN_TOKEN", ""),
                      max_state_chars=int(os.getenv("DECISION_MAX_STATE_CHARS", "200000")), startup_models=startup)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(build_from_env(), host="0.0.0.0", port=int(os.getenv("DECISION_PORT", "8000")), log_level="info")
