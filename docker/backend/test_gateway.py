"""Tests for gateway.py: auth, the model allowlist, and the extra POST paths.

Run: python docker/backend/test_gateway.py   (stdlib only; starts a stub upstream and the gateway)
"""
import importlib
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


class Upstream(BaseHTTPRequestHandler):
    seen = []

    def _reply(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        Upstream.seen.append((self.path, json.loads(body or b"{}")))
        self._reply({"upstream": self.path})

    def do_GET(self):
        self._reply({"object": "list", "data": [{"id": "decision-a"}, {"id": "decision-b"}]})

    def log_message(self, *a):
        pass


def start(handler, port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def load_gateway(upstream_port, **env):
    for k in ("GATEWAY_POST_PATHS", "GATEWAY_ALLOWED_MODELS", "GATEWAY_API_KEYS", "GATEWAY_CONFIG_FILE"):
        os.environ.pop(k, None)
    os.environ.update({"GATEWAY_UPSTREAM": f"http://127.0.0.1:{upstream_port}", "GATEWAY_API_KEYS": "k-test-123456789012", **env})
    import gateway
    gateway = importlib.reload(gateway)
    return gateway, start(gateway.Handler)


def call(port, method, path, body=None, key="k-test-123456789012"):
    h = {"Content-Type": "application/json"}
    if key:
        h["Authorization"] = f"Bearer {key}"
    r = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=10) as x:
            return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_systemone_is_refused_unless_listed():
    up = start(Upstream)
    _, gw = load_gateway(up.server_address[1])
    assert call(gw.server_address[1], "POST", "/v1/systemone", {"model": "decision-a"})[0] == 404
    assert call(gw.server_address[1], "POST", "/v1/chat/completions", {"model": "decision-a"})[0] == 200


def test_listed_path_is_proxied_with_key_and_allowlist():
    up = start(Upstream)
    Upstream.seen.clear()
    _, gw = load_gateway(up.server_address[1], GATEWAY_POST_PATHS="/v1/systemone", GATEWAY_ALLOWED_MODELS="decision-a")
    port = gw.server_address[1]
    assert call(port, "POST", "/v1/systemone", {"model": "decision-a", "state": "x"}, key=None)[0] == 401
    assert call(port, "POST", "/v1/systemone", {"model": "decision-a"}, key="wrong")[0] == 401
    assert call(port, "POST", "/v1/systemone", {"model": "decision-b"})[0] == 403  # not on the allowlist
    assert call(port, "POST", "/v1/systemone", {"state": "x"})[0] == 403  # no model at all
    status, body = call(port, "POST", "/v1/systemone/", {"model": "decision-a", "state": "x"})
    assert (status, body) == (200, {"upstream": "/v1/systemone/"})
    assert Upstream.seen[-1][1]["model"] == "decision-a"
    # /v1/models is filtered by the allowlist
    assert [m["id"] for m in call(port, "GET", "/v1/models")[1]["data"]] == ["decision-a"]


def test_admin_routes_are_never_reachable_even_if_listed():
    up = start(Upstream)
    _, gw = load_gateway(up.server_address[1], GATEWAY_POST_PATHS="/admin/models,/v1/admin/load,/v1/../admin,/v1/systemone")
    import gateway
    assert gateway._POST_ALLOWED[-1:] == ("/v1/systemone",)
    port = gw.server_address[1]
    for path in ("/admin/models", "/v1/admin/load", "/admin/models/x"):
        assert call(port, "POST", path, {"model": "m"})[0] == 404
    assert call(port, "GET", "/admin/models")[0] == 404


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
    print(f"{len(fns)} tests ok")
