#!/usr/bin/env python3
"""RantAI LLM gateway — a thin auth + model-allowlist proxy in front of Ollama.

Ollama serves every pulled model with NO auth. This gateway becomes the ONLY
thing exposed to the network; Ollama's port is kept internal (Docker network
only). Every request must carry a valid API key (`Authorization: Bearer <key>`),
and chat/completions are refused unless the requested model is in the deployed
allowlist. Everything else is proxied straight through to Ollama, streaming
preserved (SSE tokens flow live).

Config — TIER 1 is env; the JSON file is the TIER 2 hook (a future Deployments UI
writes it, so access changes live with no restart):
  GATEWAY_API_KEYS        comma-separated valid keys (Bearer). EMPTY => deny all.
  GATEWAY_ALLOWED_MODELS  comma-separated model tags clients may call.
                          EMPTY => allow all pulled models (key still required).
  GATEWAY_CONFIG_FILE     optional path to {"keys":[...],"models":[...]}. If it
                          exists it OVERRIDES the env vars and is re-read on every
                          request — this is where Tier 2 plugs in.
  GATEWAY_UPSTREAM        Ollama base URL (default http://ollama:11434).
  GATEWAY_PORT            listen port (default 8080).
  GATEWAY_POST_PATHS      comma-separated EXTRA POST paths to proxy, e.g. /v1/systemone for a gateway
                          in front of the decision server. Only /v1/... paths are accepted.
  GATEWAY_TRACE_FILE      optional path of the app's inference log (`inference-log.jsonl` in the app's data
                          volume). When set, every proxied request appends one metadata line (model,
                          status, tokens, latency; never the prompt or the reply) so API traffic shows
                          up in the LLMOps Traces view. Off by default.
  GATEWAY_BODY_LOG_DIR    optional directory for a FULL request/reply log, for diagnosing answers a client
                          reports as wrong. Off by default. One JSONL file per day (`bodies-YYYY-MM-DD.jsonl`,
                          mode 600) with the request (images replaced by their sha256 and size), the reply
                          text, and a short fingerprint of the API key (never the key). Holds user content:
                          enable only for a limited time.
  GATEWAY_BODY_LOG_DAYS   days a body log file is kept before it is deleted (default 14).
  GATEWAY_ENGINE          set to `sglang` when the upstream is SGLang. SGLang picks a LoRA adapter with
                          `model: "<base>:<adapter>"` and answers ANY other name (a bare adapter name, a
                          typo, an unloaded adapter) with the base model and HTTP 200. In this mode the
                          gateway maps the names clients use (`ask`, or `base:ask`) to that form from the
                          upstream's /v1/models, and refuses names it does not serve with 404.

Stdlib only — no extra deps.
"""
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = os.environ.get("GATEWAY_UPSTREAM", "http://ollama:11434").rstrip("/")
PORT = int(os.environ.get("GATEWAY_PORT", "8080"))
TRACE_FILE = os.environ.get("GATEWAY_TRACE_FILE", "").strip()
# Most of a reply kept in memory to read its usage block; a longer reply is traced without token counts.
_TRACE_CAPTURE = 4 * 1024 * 1024
BODY_LOG_DIR = os.environ.get("GATEWAY_BODY_LOG_DIR", "").strip()
try:
    BODY_LOG_DAYS = max(1, int(os.environ.get("GATEWAY_BODY_LOG_DAYS", "14")))
except ValueError:
    BODY_LOG_DAYS = 14
# Largest request body read into memory (32 MB leaves room for base64 images in a chat request).
MAX_BODY = int(os.environ.get("GATEWAY_MAX_BODY_BYTES", str(32 * 1024 * 1024)))

# Only the OpenAI inference endpoints are exposed. Ollama's native /api/* routes
# (pull / delete / create / tags / ps …) are DELIBERATELY not proxied: holding an
# API key must never let a client mutate the server or pull arbitrary models.
_POST_ALLOWED = ("/v1/chat/completions", "/v1/completions", "/v1/embeddings")


def _extra_post_paths():
    """Extra POST paths for a gateway in front of something that is not an LLM server (the decision
    server's /v1/systemone). Only `/v1/...` paths are accepted: that keeps an upstream's own admin
    routes (the decision server has /admin/models) out of reach of an API key, whatever is listed."""
    paths = []
    for p in os.environ.get("GATEWAY_POST_PATHS", "").split(","):
        p = p.strip().rstrip("/")
        if p.startswith("/v1/") and ".." not in p and "admin" not in p.lower():
            paths.append(p)
        elif p:
            print(f"[rantai-gateway] ignoring GATEWAY_POST_PATHS entry {p!r}: only /v1/... paths are allowed", flush=True)
    return tuple(paths)


_POST_ALLOWED = _POST_ALLOWED + _extra_post_paths()


def _summarize_reply(captured, streamed):
    """(prompt_tokens, completion_tokens, finish_reason) from an OpenAI-style reply. Reads the `usage`
    block when the server sent one; a stream without it is counted by its content events (about one
    token each). Replies that are not OpenAI-shaped (the decision server's) give zeros."""
    prompt = completion = 0
    finish = ""
    counted = 0
    objs = []
    text = captured.decode("utf-8", "replace")
    if streamed:
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("data:") and line[5:].strip() not in ("", "[DONE]"):
                try:
                    objs.append(json.loads(line[5:]))
                except ValueError:
                    pass
    else:
        try:
            objs.append(json.loads(text))
        except ValueError:
            pass
    for o in objs:
        if not isinstance(o, dict):
            continue
        usage = o.get("usage")
        if isinstance(usage, dict):
            prompt = int(usage.get("prompt_tokens") or prompt)
            completion = int(usage.get("completion_tokens") or completion)
        choice = (o.get("choices") or [None])[0]
        if isinstance(choice, dict):
            finish = choice.get("finish_reason") or finish
            delta = choice.get("delta") or {}
            if isinstance(delta, dict) and (delta.get("content") or delta.get("reasoning_content")):
                counted += 1
    if streamed and not completion:
        completion = counted
    return prompt, completion, finish


def _trace(model, status, started, first_byte, captured, streamed):
    """Append one inference event for the Traces view. Never raises: tracing must not break a request."""
    if not TRACE_FILE:
        return
    try:
        total = max(0.0, time.time() - started)
        ttft = max(0.0, (first_byte or time.time()) - started)
        prompt, completion, finish = _summarize_reply(captured, streamed) if status == "ok" else (0, 0, "")
        gen = max(total - ttft, 1e-6)
        event = {
            "ts": int(started * 1000),
            "model": model or "unknown",
            "engine": "gateway",
            "status": status,
            "tokens": prompt + completion,
            "promptTokens": prompt,
            "completionTokens": completion,
            "tokS": round(completion / gen, 2) if completion else 0,
            "ttftMs": round(ttft * 1000),
            "totalMs": round(total * 1000),
            "finishReason": finish or ("error" if status == "error" else ""),
        }
        os.makedirs(os.path.dirname(TRACE_FILE) or ".", exist_ok=True)
        with open(TRACE_FILE, "a", encoding="utf-8") as f:  # one short write: concurrent lines do not interleave
            f.write(json.dumps(event) + "\n")
    except Exception as e:  # noqa: BLE001
        print(f"[rantai-gateway] trace write failed: {e}", flush=True)


def _redact_images(obj):
    """A copy of a request with every inline image (`data:...;base64,...`) replaced by its sha256 and size,
    so the log keeps which image was sent without storing the picture."""
    if isinstance(obj, dict):
        return {k: _redact_images(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact_images(v) for v in obj]
    if isinstance(obj, str) and obj.startswith("data:") and ";base64," in obj[:100]:
        head, _, data = obj.partition(",")
        return {"redacted": head, "sha256": hashlib.sha256(data.encode()).hexdigest(), "base64Bytes": len(data)}
    return obj


def _reply_text(captured, streamed):
    """The reply as the client saw it: the parsed JSON, or for a stream the joined content, reasoning,
    finish reason and usage."""
    text = captured.decode("utf-8", "replace")
    if not streamed:
        try:
            return json.loads(text)
        except ValueError:
            return text[:20000]
    content, reasoning, finish, usage = [], [], "", None
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:") or line[5:].strip() in ("", "[DONE]"):
            continue
        try:
            o = json.loads(line[5:])
        except ValueError:
            continue
        if isinstance(o, dict):
            usage = o.get("usage") or usage
            choice = (o.get("choices") or [None])[0]
            if isinstance(choice, dict):
                finish = choice.get("finish_reason") or finish
                delta = choice.get("delta") or {}
                if isinstance(delta, dict):
                    content.append(delta.get("content") or "")
                    reasoning.append(delta.get("reasoning_content") or "")
    out = {"content": "".join(content), "finish_reason": finish, "usage": usage}
    if any(reasoning):
        out["reasoning"] = "".join(reasoning)
    return out


_body_log_pruned = {"at": 0.0}


def _body_log(key_id, path, request, status, http_status, started, captured, streamed):
    """Append one full request/reply record. Never raises: logging must not break a request."""
    if not BODY_LOG_DIR:
        return
    try:
        old = os.umask(0o077)
        try:
            os.makedirs(BODY_LOG_DIR, exist_ok=True)
            day = time.strftime("%Y-%m-%d", time.gmtime(started))
            record = {
                "ts": int(started * 1000),
                "key": key_id,
                "path": path,
                "status": status,
                "httpStatus": http_status,
                "totalMs": round((time.time() - started) * 1000),
                "request": _redact_images(request),
                "reply": _reply_text(captured, streamed),
            }
            with open(os.path.join(BODY_LOG_DIR, f"bodies-{day}.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        finally:
            os.umask(old)
        now = time.time()
        if now - _body_log_pruned["at"] > 3600:  # delete expired days at most once an hour
            _body_log_pruned["at"] = now
            cutoff = now - BODY_LOG_DAYS * 86400
            for name in os.listdir(BODY_LOG_DIR):
                full = os.path.join(BODY_LOG_DIR, name)
                if name.startswith("bodies-") and name.endswith(".jsonl") and os.path.getmtime(full) < cutoff:
                    os.remove(full)
    except Exception as e:  # noqa: BLE001
        print(f"[rantai-gateway] body log write failed: {e}", flush=True)


ENGINE = os.environ.get("GATEWAY_ENGINE", "").strip().lower()
_SGLANG_TTL = 5.0
_sglang_cache = {"at": 0.0, "base": None, "adapters": frozenset()}


def _sglang_served(force=False):
    """(base, adapters) from SGLang's /v1/models: the base is the entry without `parent`, the adapters
    are the entries whose `parent` is that base. Cached for a few seconds; (None, empty) if unreachable."""
    now = time.time()
    if not force and _sglang_cache["base"] and now - _sglang_cache["at"] < _SGLANG_TTL:
        return _sglang_cache["base"], _sglang_cache["adapters"]
    try:
        with urllib.request.urlopen(UPSTREAM + "/v1/models", timeout=10) as r:
            data = json.loads(r.read()).get("data") or []
    except Exception:  # noqa: BLE001
        return None, frozenset()
    base = next((m.get("id") for m in data if isinstance(m, dict) and m.get("id") and not m.get("parent")), None)
    adapters = frozenset(m["id"] for m in data if isinstance(m, dict) and m.get("id") and base and m.get("parent") == base)
    _sglang_cache.update(at=now, base=base, adapters=adapters)
    return base, adapters


def client_model_name(model):
    """The name a client means: `base:ask` and `ask` are the same adapter in SGLang mode. Used for the
    allowlist and the trace, so both spellings are treated alike."""
    if ENGINE == "sglang" and isinstance(model, str) and ":" in model:
        base, _ = _sglang_served()
        if base and model.startswith(base + ":"):
            return model[len(base) + 1:]
    return model


def sglang_upstream_model(model):
    """SGLang's `<base>:<adapter>` for a client's name, the base for the base, or None if not served."""
    if not isinstance(model, str) or not model:
        return None
    for force in (False, True):  # a miss re-reads /v1/models once: the adapter may have just been loaded
        base, adapters = _sglang_served(force=force)
        if not base:
            continue
        if model == base:
            return base
        name = model[len(base) + 1:] if model.startswith(base + ":") else model
        if name in adapters:
            return f"{base}:{name}"
    return None


def _split_env(name):
    return {v.strip() for v in os.environ.get(name, "").split(",") if v.strip()}


def load_config():
    """Return (keys:set, models:set). Prefer the JSON config file (Tier 2, live),
    else fall back to the env vars (Tier 1)."""
    path = os.environ.get("GATEWAY_CONFIG_FILE")
    if path and os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                cfg = json.load(f)
            return set(cfg.get("keys") or []), set(cfg.get("models") or [])
        except Exception:
            pass  # half-written / broken file -> fall back to env
    return _split_env("GATEWAY_API_KEYS"), _split_env("GATEWAY_ALLOWED_MODELS")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # A client that opens a connection and then sends nothing (or trickles bytes) must not hold a
    # thread forever. Applies to socket reads/writes, not to the upstream call.
    timeout = 120

    # ---- helpers ------------------------------------------------------------
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _bearer(self):
        h = self.headers.get("Authorization", "")
        return h[7:].strip() if h[:7].lower() == "bearer " else ""

    def _authed(self, keys):
        # No keys configured => fail closed (deny everything), never open. Compare
        # in constant time so a valid key can't be recovered via response timing.
        token = self._bearer().encode("utf-8")
        return bool(token) and any(hmac.compare_digest(token, k.encode("utf-8")) for k in keys)

    def _unauthorized(self):
        self._json(401, {"error": {"message": "invalid or missing API key", "type": "auth"}})

    def _read_body(self):
        """The request body, or None after answering 400/411/413 for one that cannot be read safely."""
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            self._json(411, {"error": {"message": "send the body with a Content-Length", "type": "invalid_request"}})
            return None
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            n = -1
        if n < 0:
            self._json(400, {"error": {"message": "invalid Content-Length", "type": "invalid_request"}})
            return None
        if n > MAX_BODY:
            self._json(413, {"error": {"message": f"the body is larger than {MAX_BODY} bytes", "type": "payload_too_large"}})
            return None
        return self.rfile.read(n) if n else b""

    def _key_id(self):
        """A short fingerprint of the caller's key for the body log (never the key itself)."""
        return hashlib.sha256(self._bearer().encode("utf-8")).hexdigest()[:8]

    def _proxy(self, method, body=None, model="", streamed=False, request=None):
        started = time.time()
        path = self.path.split("?")[0]
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            _trace(model, "error", started, None, b"", streamed)
            raw = e.read()
            _body_log(self._key_id(), path, request, "error", e.code, started, raw, False)
            try:
                upstream = json.loads(raw)  # pass a JSON error through as JSON, keeping its "type"
            except ValueError:
                upstream = None
            if isinstance(upstream, dict) and "error" in upstream:
                self._json(e.code, upstream)
            else:
                self._json(e.code, {"error": {"message": raw.decode("utf-8", "replace")[:500]}})
            return
        except Exception as e:  # noqa: BLE001
            _trace(model, "error", started, None, b"", streamed)
            _body_log(self._key_id(), path, request, "error", 502, started, str(e).encode(), False)
            self._json(502, {"error": {"message": f"gateway upstream error: {e}"}})
            return
        # Stream the upstream body straight back. No Content-Length + Connection:
        # close => the client reads until we close, which works for both a normal
        # JSON reply and a long-lived SSE stream (tokens forwarded as they arrive).
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        first_byte = None
        captured = bytearray()
        ok = True
        while True:
            chunk = resp.read(8192)
            if not chunk:
                break
            if first_byte is None:
                first_byte = time.time()
            if (TRACE_FILE or BODY_LOG_DIR) and len(captured) < _TRACE_CAPTURE:
                captured += chunk
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                ok = False  # the client left mid-reply: still a request worth showing
                break
        status = "ok" if ok and resp.status < 400 else "error"
        _trace(model, status, started, first_byte, bytes(captured), streamed)
        _body_log(self._key_id(), path, request, status if ok else "client_left", resp.status, started, bytes(captured), streamed)

    # ---- routes -------------------------------------------------------------
    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/health", "/healthz"):
            self._json(200, {"status": "ok", "service": "rantai-gateway"})
            return
        keys, models = load_config()
        if not self._authed(keys):
            self._unauthorized()
            return
        if self.path.split("?")[0].rstrip("/") == "/v1/models":
            self._list_models(models)
            return
        # Nothing else is proxied on GET — Ollama's admin routes (/api/tags,
        # /api/ps, …) must not be reachable through the gateway.
        self._json(404, {"error": {"message": "not found", "type": "not_found"}})

    def do_POST(self):
        keys, models = load_config()
        if not self._authed(keys):
            self._unauthorized()
            return
        path = self.path.split("?")[0].rstrip("/")
        if path not in _POST_ALLOWED:
            self._json(404, {"error": {"message": "not found", "type": "not_found"}})
            return
        body = self._read_body()
        if body is None:
            return
        streamed = False
        parsed = None
        try:
            parsed = json.loads(body or b"{}") or {}
            model = parsed.get("model", "")
            streamed = parsed.get("stream") is True
        except Exception:
            model = ""
        model = client_model_name(model)
        if models and model not in models:
            self._json(403, {"error": {"message": f"model '{model}' is not deployed", "type": "model_not_allowed"}})
            return
        if ENGINE == "sglang" and isinstance(parsed, dict) and "model" in parsed:
            upstream_model = sglang_upstream_model(model)
            if upstream_model is None:
                self._json(404, {"error": {"message": f"model '{model}' is not served", "type": "model_not_found"}})
                return
            if upstream_model != parsed.get("model"):
                parsed["model"] = upstream_model
                body = json.dumps(parsed).encode("utf-8")
        self._proxy("POST", body, model=model if isinstance(model, str) else "", streamed=streamed,
                    request=parsed if parsed is not None else body.decode("utf-8", "replace")[:20000])

    def _list_models(self, allowed):
        # OpenAI /v1/models, but only the allowed tags (empty allowlist => all).
        try:
            with urllib.request.urlopen(UPSTREAM + "/v1/models", timeout=30) as r:
                data = json.loads(r.read())
        except Exception:
            data = {"object": "list", "data": []}
        items = [m for m in data.get("data", []) if not allowed or m.get("id") in allowed]
        self._json(200, {"object": "list", "data": items})

    def log_message(self, *args):  # silence access logs
        pass


if __name__ == "__main__":
    print(f"[rantai-gateway] listening on :{PORT} -> {UPSTREAM}" + (f" ({ENGINE} names)" if ENGINE else ""), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
