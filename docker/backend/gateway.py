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

Stdlib only — no extra deps.
"""
import hmac
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = os.environ.get("GATEWAY_UPSTREAM", "http://ollama:11434").rstrip("/")
PORT = int(os.environ.get("GATEWAY_PORT", "8080"))

# Only the OpenAI inference endpoints are exposed. Ollama's native /api/* routes
# (pull / delete / create / tags / ps …) are DELIBERATELY not proxied: holding an
# API key must never let a client mutate the server or pull arbitrary models.
_POST_ALLOWED = ("/v1/chat/completions", "/v1/completions", "/v1/embeddings")


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
        n = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(n) if n else b""

    def _proxy(self, method, body=None):
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            self._json(e.code, {"error": {"message": e.read().decode("utf-8", "replace")[:500]}})
            return
        except Exception as e:  # noqa: BLE001
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
        while True:
            chunk = resp.read(8192)
            if not chunk:
                break
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                break

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
        try:
            model = (json.loads(body or b"{}") or {}).get("model", "")
        except Exception:
            model = ""
        if models and model not in models:
            self._json(403, {"error": {"message": f"model '{model}' is not deployed", "type": "model_not_allowed"}})
            return
        self._proxy("POST", body)

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
