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
  DECISION_MODEL_ROOTS    ":"-separated directories a model path must live under (/root/.transformerlab/orgs,
                          where Transformer Lab writes every job's output)
  DECISION_MAX_MODELS     how many models may be loaded at once (3); each holds GPU memory
  DECISION_MAX_STATE_CHARS  longest accepted state (200000)
  DECISION_MAX_BODY_BYTES   largest accepted request body (8 MB)
  DECISION_MIN_FREE_GB      refuse a load when less GPU memory than this is free (12); the GPU is
                            shared with vLLM, and on the GB10 with the host itself
  DECISION_QUEUE_TIMEOUT    seconds a request may wait for a busy model before a 503 (120)

GET /ready answers 503 until the remembered models have been restored; /health is liveness only.
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


def cuda_free_gb() -> float | None:
    """Free GPU memory in GB, or None when it cannot be measured (no CUDA, e.g. in tests)."""
    try:
        import torch

        if not torch.cuda.is_available():
            return None
        free, _total = torch.cuda.mem_get_info()
        return free / 1024**3
    except Exception:  # noqa: BLE001 - a missing measurement must not block a load
        return None


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
                 state_file: str | None = None, roots: list[str] | None = None, max_models: int = 3,
                 free_gb: Callable[[], float | None] = cuda_free_gb, min_free_gb: float = 0.0):
        self.loader, self.predictor, self.free = loader, predictor, free
        self.free_gb, self.min_free_gb = free_gb, min_free_gb
        self.state_file = state_file
        self.roots = [Path(r).resolve() for r in (roots if roots is not None else ["/root/.transformerlab"])]
        self.max_models = max_models
        # Loaded models AND remembered ones that failed to load (model None, error set): a failed
        # restore must stay visible and stay in the state file, or one bad boot forgets the model.
        self.models: dict[str, Served] = {}
        self._mutex = threading.Lock()  # guards the dict and the state file, never held while loading
        self._loading: set[str] = set()
        self.ready = False

    def snapshot(self) -> list[Served]:
        with self._mutex:
            return list(self.models.values())

    def _loaded_count(self) -> int:
        return sum(1 for s in self.models.values() if s.model is not None)

    # -- paths ---------------------------------------------------------------------------
    def resolve_path(self, path: str) -> str:
        """A model folder under an allowed root that holds a decision model. Anything else is refused:
        the admin API must not be a way to make the server read an arbitrary directory."""
        if not isinstance(path, str) or not path:
            raise ServerError(400, "path must be a non-empty string", "invalid_path")
        try:
            p = Path(path).resolve()
        except (OSError, ValueError, RuntimeError) as e:
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
        if not isinstance(name, str) or not NAME_RE.match(name):
            raise ServerError(400, "name must be 1-64 characters of letters, digits, . _ -", "invalid_name")
        if not isinstance(load_in_4bit, bool):
            raise ServerError(422, "load_in_4bit must be true or false", "invalid_request")
        if isinstance(max_seq_length, bool) or not isinstance(max_seq_length, int) or not 256 <= max_seq_length <= 65536:
            raise ServerError(422, "max_seq_length must be a whole number between 256 and 65536", "invalid_request")
        real = self.resolve_path(path)
        with self._mutex:
            existing = self.models.get(name)
            if name in self._loading or (existing is not None and existing.model is not None):
                raise ServerError(409, f"a model named '{name}' is already served", "conflict")
            if self._loaded_count() + len(self._loading) >= self.max_models:
                raise ServerError(409, f"at most {self.max_models} models can be loaded at once", "conflict")
            self._loading.add(name)
        free = self.free_gb() if self.min_free_gb > 0 else None
        if free is not None and free < self.min_free_gb:
            with self._mutex:
                self._loading.discard(name)
            raise ServerError(507, f"only {free:.1f} GB of GPU memory is free; loading needs at least "
                                   f"{self.min_free_gb:.0f} GB (unload a model or stop another GPU job)", "insufficient_memory")
        served = Served(name, real, load_in_4bit, max_seq_length)
        try:
            served.model, served.processor = self.loader(real, served.load_in_4bit, served.max_seq_length)
            served.loaded_at = time.time()
        except Exception as e:  # noqa: BLE001
            served.model = served.processor = None
            self.free()  # a load that died half-way (often out of memory) must not keep what it allocated
            log.exception("loading %s failed", name)
            with self._mutex:
                self._loading.discard(name)
            raise ServerError(500, f"could not load the model: {str(e)[:300]}", "load_failed") from e
        with self._mutex:
            self._loading.discard(name)
            self.models[name] = served  # replaces a failed-restore placeholder of the same name
            if persist:
                self._persist()
        return served

    def unload(self, name: str) -> None:
        with self._mutex:
            if name in self._loading:
                raise ServerError(409, f"model '{name}' is still loading; unload it once it is ready", "conflict")
            served = self.models.pop(name, None)
            if served is None:
                raise ServerError(404, f"model '{name}' is not served", "model_not_found")
            self._persist()
        with served.lock:  # wait for a prediction in flight
            served.model = served.processor = None
        self.free()

    def get(self, name: str) -> Served | None:
        with self._mutex:
            return self.models.get(name)

    def restore(self, extra: list[dict] | None = None) -> None:
        """Load the remembered models plus any given at start. A model that fails is kept as a
        visible, unloaded entry (and stays in the state file), never fatal: one broken entry must not
        keep the others from being served, and one bad boot must not forget a deployed model."""
        try:
            seen = set()
            entries = [*self.entries_from_disk(), *(extra if isinstance(extra, list) else [])]
            for entry in entries:
                if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or entry["name"] in seen:
                    continue
                name = entry["name"]
                seen.add(name)
                raw_msl = entry.get("max_seq_length", 4096)
                msl = int(raw_msl) if isinstance(raw_msl, (int, str)) and str(raw_msl).isdigit() else 4096
                in4 = entry.get("load_in_4bit", False) is True
                try:
                    self.load(name, entry.get("path"), in4, msl, persist=False)
                    log.info("loaded %s", name)
                except Exception as e:  # noqa: BLE001 - any broken entry, not only a ServerError
                    message = e.message if isinstance(e, ServerError) else str(e)
                    log.error("could not restore %s: %s", name, message)
                    if NAME_RE.match(name):
                        failed = Served(name, str(entry.get("path", "")), in4, msl)
                        failed.error = f"not loaded at start: {message[:300]}"
                        with self._mutex:
                            self.models.setdefault(name, failed)
            with self._mutex:
                self._persist()
        finally:
            self.ready = True


# ─────────────────────────────────────── app ───────────────────────────────────────────


def _error(status: int, message: str, kind: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"message": message, "type": kind}})


async def _json_body(request: Request, max_bytes: int) -> Any:
    """The parsed JSON body, refusing an oversized one before reading it all into memory."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > max_bytes:
                raise ServerError(413, f"the body is larger than {max_bytes} bytes", "payload_too_large")
        except ValueError:
            raise ServerError(400, "invalid Content-Length", "invalid_request") from None
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > max_bytes:
            raise ServerError(413, f"the body is larger than {max_bytes} bytes", "payload_too_large")
    try:
        return json.loads(raw)
    except (ValueError, RecursionError):
        raise ServerError(400, "the body is not valid JSON", "invalid_request") from None


def _input_tokens(served: Served, state: Any) -> int:
    try:
        text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
        tok = getattr(served.processor, "tokenizer", served.processor)
        return len(tok.encode(text))
    except Exception:  # noqa: BLE001 - usage is informational
        return 0


def create_app(registry: Registry, admin_token: str = "", max_state_chars: int = 200_000,
               startup_models: list[dict] | None = None, max_body_bytes: int = 8 * 1024 * 1024,
               queue_timeout: float = 120.0) -> FastAPI:
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
                "models": sorted(s.name for s in registry.snapshot() if s.model is not None)}

    @app.get("/ready")
    async def ready():
        # 503 while the remembered models are still being restored, so a probe does not route traffic
        # to a server that would answer model_not_found for a model that is about to appear.
        body = {"ready": registry.ready, "models": sorted(s.name for s in registry.snapshot() if s.model is not None)}
        return JSONResponse(status_code=200 if registry.ready else 503, content=body)

    @app.get("/v1/models")
    async def models():
        return {"object": "list", "data": [
            {"id": s.name, "object": "model", "owned_by": "rantai", "created": int(s.loaded_at or 0)}
            for s in sorted(registry.snapshot(), key=lambda s: s.name) if s.model is not None
        ]}

    @app.post("/v1/systemone")
    async def systemone(request: Request):
        body = await _json_body(request, max_body_bytes)
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
            # A model answers one request at a time; a request that cannot get it within the queue
            # timeout is refused instead of piling up behind a slow one until the gateway gives up.
            if not served.lock.acquire(timeout=queue_timeout):
                raise ServerError(503, f"model '{name}' is busy; try again shortly", "busy")
            try:
                if served.model is None:  # unloaded while this request waited for the lock
                    raise ServerError(404, f"model '{name}' is not served", "model_not_found")
                answers = registry.predictor(served.model, served.processor, state, questions)
                # Tokenize under the same lock: a fast tokenizer is not safe to share across threads.
                return answers, _input_tokens(served, state)
            finally:
                served.lock.release()

        try:
            answers, input_tokens = await run_in_threadpool(run)
        except ServerError:
            raise
        except Exception as e:  # noqa: BLE001
            # Unsloth raises DecisionDataError (a ValueError) for input it cannot use, e.g. options that
            # do not fit the context. That is the caller's problem; anything else is ours, and its text
            # (CUDA errors, file paths) stays in the server log.
            if type(e).__name__ == "DecisionDataError":
                raise ServerError(422, str(e)[:500], "invalid_request") from e
            log.exception("prediction failed")
            raise ServerError(500, "prediction failed; see the decision server log", "internal_error") from e
        content = {"model": name, "answers": answers, "usage": {"input_tokens": input_tokens, "output_tokens": 0}}
        return JSONResponse(content=jsonable_encoder(content, custom_encoder={_np_generic(): lambda o: o.item()}),
                            headers={"x-decision-backend": "pytorch"})

    # ── admin ──
    @app.get("/admin/models")
    async def admin_list(request: Request):
        require_admin(request)
        return {"models": [s.describe() for s in registry.snapshot()], "max_models": registry.max_models}

    @app.post("/admin/models")
    async def admin_load(request: Request):
        require_admin(request)
        body = await _json_body(request, 64 * 1024)
        if not isinstance(body, dict) or not isinstance(body.get("name"), str) or not isinstance(body.get("path"), str):
            raise ServerError(422, "`name` and `path` are required strings", "invalid_request")
        served = await run_in_threadpool(
            registry.load, body["name"], body["path"], body.get("load_in_4bit", False),
            body.get("max_seq_length", 4096),
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
        roots=[r for r in os.getenv("DECISION_MODEL_ROOTS", "/root/.transformerlab/orgs").split(":") if r],
        max_models=int(os.getenv("DECISION_MAX_MODELS", "3")),
        min_free_gb=float(os.getenv("DECISION_MIN_FREE_GB", "12")),
    )
    startup = []
    raw = os.getenv("DECISION_MODELS", "").strip()
    if raw:
        try:
            startup = json.loads(raw)
        except ValueError:
            log.error("DECISION_MODELS is not valid JSON; ignored")
        if not isinstance(startup, list):
            log.error("DECISION_MODELS must be a JSON list; ignored")
            startup = []
    return create_app(registry, admin_token=os.getenv("DECISION_ADMIN_TOKEN", ""),
                      max_state_chars=int(os.getenv("DECISION_MAX_STATE_CHARS", "200000")), startup_models=startup,
                      max_body_bytes=int(os.getenv("DECISION_MAX_BODY_BYTES", str(8 * 1024 * 1024))),
                      queue_timeout=float(os.getenv("DECISION_QUEUE_TIMEOUT", "120")))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(build_from_env(), host="0.0.0.0", port=int(os.getenv("DECISION_PORT", "8000")), log_level="info")
