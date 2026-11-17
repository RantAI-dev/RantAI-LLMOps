"""Tests for the gateway's citation guard (GATEWAY_CITATION_GUARD).

Run: python docker/backend/test_gateway_citeguard.py   (stdlib only; starts a stub upstream and the gateway)
"""
import glob
import importlib
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_gateway_trace as tt  # noqa: E402  (start, post helper and KEY)

# Sources 1-2 are text, 3 is a figure. The reply cites a figure that is text ([figure:2]), a figure that exists
# ([figure:3]) and a number past the list ([7]).
SYSTEM = (
    "Kamu adalah Elise.\n\n## Knowledge Base Context\n\nExcerpts:\n[1] Buku A — Bab 1\nteks\n\n---\n\n[2] Buku A — Bab 2\nteks\n\n"
    "Sources:\n1. Buku A — Bab 1\n2. Buku A — Bab 2\n3. [FIGURE] Buku A — Ilustrasi"
)
REPLY = "Magnet menarik besi [1]. Kutubnya dua [2][7].\n[figure:2]\nGaris gaya magnet [1]:\n[figure:3]\nSelesai [9]."
# The same reply streamed in pieces that cut tags in half.
PIECES = ["Magnet menarik besi [", "1]. Kutubnya dua [2][", "7].\n[fig", "ure:2]\nGaris gaya magnet [1]:\n[figure:", "3]\nSelesai [9", "]."]


class Upstream(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)) or b"{}")
        self.send_response(200)
        if body.get("stream"):
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for p in PIECES:
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": p}}]}) + "\n\n").encode())
            self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"choices": [{"message": {"content": REPLY}, "finish_reason": "stop"}]}).encode())

    def log_message(self, *a):
        pass


def gateway(guard=True, log_dir=None):
    up = tt.start(Upstream)
    for k in ("GATEWAY_POST_PATHS", "GATEWAY_ALLOWED_MODELS", "GATEWAY_CONFIG_FILE", "GATEWAY_TRACE_FILE",
              "GATEWAY_BODY_LOG_DIR", "GATEWAY_CITATION_GUARD"):
        os.environ.pop(k, None)
    os.environ.update({"GATEWAY_UPSTREAM": f"http://127.0.0.1:{up.server_address[1]}", "GATEWAY_API_KEYS": tt.KEY})
    if guard:
        os.environ["GATEWAY_CITATION_GUARD"] = "1"
    if log_dir:
        os.environ["GATEWAY_BODY_LOG_DIR"] = log_dir
    import gateway as g

    g = importlib.reload(g)
    return tt.start(g.Handler).server_address[1]


def streamed_text(body):
    out = ""
    for line in body.decode().splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            for c in json.loads(line[6:]).get("choices", []):
                out += (c.get("delta") or {}).get("content") or ""
    return out


WANT = "Magnet menarik besi [1]. Kutubnya dua [2].\n\nGaris gaya magnet [1]:\n[figure:3]\nSelesai."


def test_a_whole_reply_keeps_only_tags_that_point_somewhere():
    port = gateway()
    status, body = tt.post(port, {"model": "ask", "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "q"}]})
    assert status == 200
    assert json.loads(body)["choices"][0]["message"]["content"] == WANT


def test_a_stream_is_fixed_even_when_tags_are_cut_across_chunks():
    port = gateway()
    status, body = tt.post(port, {"model": "ask", "stream": True,
                                  "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "q"}]})
    assert status == 200
    assert streamed_text(body) == WANT
    assert body.rstrip().endswith(b"data: [DONE]")


def test_a_request_without_a_sources_list_is_untouched():
    port = gateway()
    _, body = tt.post(port, {"model": "ask", "messages": [{"role": "user", "content": "q"}]})
    assert json.loads(body)["choices"][0]["message"]["content"] == REPLY


def test_the_guard_is_off_unless_configured():
    port = gateway(guard=False)
    _, body = tt.post(port, {"model": "ask", "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "q"}]})
    assert json.loads(body)["choices"][0]["message"]["content"] == REPLY


def test_what_was_removed_is_counted_in_the_body_log():
    d = tempfile.mkdtemp()
    port = gateway(log_dir=d)
    tt.post(port, {"model": "ask", "stream": True, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "q"}]})
    (path,) = glob.glob(os.path.join(d, "bodies-*.jsonl"))
    (r,) = [json.loads(x) for x in open(path, encoding="utf-8")]
    assert r["guard"] == {"sources": 3, "figures": [3], "removed": {"figure": 1, "cite": 2}}
    assert r["reply"]["content"] == WANT


def test_sources_parsing_stops_at_the_end_of_the_numbered_list():
    import gateway as g

    sysmsg = SYSTEM + "\nRelated entities: magnet (konsep)\n\n## Skills\n4. not a source"
    guard = g.CiteGuard.from_request({"messages": [{"role": "system", "content": sysmsg}]})
    assert (guard.n_sources, sorted(guard.figures)) == (3, [3])
    assert g.CiteGuard.from_request({"messages": [{"role": "system", "content": "no list"}]}) is None
    assert g.CiteGuard.from_request({"messages": "broken"}) is None


def test_a_source_title_that_spans_lines_does_not_end_the_list():
    """Seen in the UGM log: a section heading followed by a line of code inside one Sources entry. Reading the
    second line as the end of the list would have counted one source and dropped every valid [2]."""
    import gateway as g

    sysmsg = ("ctx\nSources:\n1. Koding dan KA Kelas XI — --- Tutup Koneksi ---\nconn.close()\n"
              "2. Informatika Kelas XI\n3. [FIGURE] Informatika — Ilustrasi\nRelated entities: SQL (konsep)")
    guard = g.CiteGuard.from_request({"messages": [{"role": "system", "content": sysmsg}]})
    assert (guard.n_sources, sorted(guard.figures)) == (3, [3])
    assert guard.fix("Koneksi ditutup [1]. SQL dipakai [2].\n[figure:3]") == "Koneksi ditutup [1]. SQL dipakai [2].\n[figure:3]"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("ok", t.__name__)
