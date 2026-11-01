"""Tests for the gateway's opt-in request tracing (GATEWAY_TRACE_FILE).

Run: python docker/backend/test_gateway_trace.py   (stdlib only; starts a stub upstream and the gateway)
"""
import importlib
import json
import os
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KEY = "k-test-123456789012"


class Upstream(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)) or b"{}")
        if body.get("model") == "broken":
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": {"message": "boom"}}')
            return
        self.send_response(200)
        if body.get("stream"):
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for word in ("Hello", " there", "!"):
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": word}}]}) + "\n\n").encode())
            self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            reply = {"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 12, "completion_tokens": 5}}
            self.wfile.write(json.dumps(reply).encode())

    def log_message(self, *a):
        pass


def start(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def gateway(trace_file):
    up = start(Upstream)
    for k in ("GATEWAY_POST_PATHS", "GATEWAY_ALLOWED_MODELS", "GATEWAY_CONFIG_FILE", "GATEWAY_TRACE_FILE"):
        os.environ.pop(k, None)
    os.environ.update({"GATEWAY_UPSTREAM": f"http://127.0.0.1:{up.server_address[1]}", "GATEWAY_API_KEYS": KEY})
    if trace_file:
        os.environ["GATEWAY_TRACE_FILE"] = trace_file
    import gateway

    gateway = importlib.reload(gateway)
    return start(gateway.Handler).server_address[1]


def post(port, body):
    r = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
    )
    try:
        with urllib.request.urlopen(r, timeout=10) as x:
            return x.status, x.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def events(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def test_reply_with_usage_is_traced_without_its_text():
    path = os.path.join(tempfile.mkdtemp(), "data", "inference-log.jsonl")
    port = gateway(path)
    status, _ = post(port, {"model": "m1", "messages": [{"role": "user", "content": "secret question"}]})
    assert status == 200
    (e,) = events(path)
    assert e["model"] == "m1" and e["status"] == "ok" and e["engine"] == "gateway"
    assert (e["promptTokens"], e["completionTokens"], e["tokens"]) == (12, 5, 17)
    assert e["finishReason"] == "stop" and e["totalMs"] >= 0
    assert "secret question" not in open(path, encoding="utf-8").read()


def test_stream_without_usage_is_counted_by_its_content_events():
    path = os.path.join(tempfile.mkdtemp(), "inference-log.jsonl")
    port = gateway(path)
    status, body = post(port, {"model": "m1", "stream": True, "messages": []})
    assert status == 200 and b"Hello" in body  # the client still gets the stream
    (e,) = events(path)
    assert e["completionTokens"] == 3 and e["finishReason"] == "stop" and e["status"] == "ok"


def test_upstream_error_is_traced_as_an_error():
    path = os.path.join(tempfile.mkdtemp(), "inference-log.jsonl")
    port = gateway(path)
    status, _ = post(port, {"model": "broken", "messages": []})
    assert status == 500
    (e,) = events(path)
    assert e["status"] == "error" and e["model"] == "broken" and e["tokens"] == 0


def test_tracing_is_off_unless_configured():
    port = gateway("")
    status, _ = post(port, {"model": "m1", "messages": []})
    assert status == 200  # no file, no error


def test_an_unwritable_trace_file_never_breaks_a_request():
    blocker = os.path.join(tempfile.mkdtemp(), "file")
    open(blocker, "w").close()
    port = gateway(os.path.join(blocker, "inference-log.jsonl"))  # its parent is a file, not a directory
    status, body = post(port, {"model": "m1", "messages": []})
    assert status == 200 and b"usage" in body


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"{len(tests)} tests ok")
