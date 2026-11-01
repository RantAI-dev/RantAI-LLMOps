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

Stdlib only — no extra deps.
"""
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

    def _proxy(self, method, body=None, model="", streamed=False):
        started = time.time()
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            _trace(model, "error", started, None, b"", streamed)
            raw = e.read()
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
            if TRACE_FILE and len(captured) < _TRACE_CAPTURE:
                captured += chunk
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                ok = False  # the client left mid-reply: still a request worth showing
                break
        _trace(model, "ok" if ok and resp.status < 400 else "error", started, first_byte, bytes(captured), streamed)

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
        try:
            parsed = json.loads(body or b"{}") or {}
            model = parsed.get("model", "")
            streamed = parsed.get("stream") is True
        except Exception:
            model = ""
        if models and model not in models:
            self._json(403, {"error": {"message": f"model '{model}' is not deployed", "type": "model_not_allowed"}})
            return
        self._proxy("POST", body, model=model if isinstance(model, str) else "", streamed=streamed)

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
    print(f"[rantai-gateway] listening on :{PORT} -> {UPSTREAM}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
