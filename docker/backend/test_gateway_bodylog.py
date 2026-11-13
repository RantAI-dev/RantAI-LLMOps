"""Tests for the gateway's opt-in full request/reply log (GATEWAY_BODY_LOG_DIR).

Run: python docker/backend/test_gateway_bodylog.py   (stdlib only; starts a stub upstream and the gateway)
"""
import glob
import importlib
import json
import os
import stat
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_gateway_trace as tt  # noqa: E402  (stub upstream, post helper and KEY)


def gateway(log_dir, days=None):
    for k in ("GATEWAY_BODY_LOG_DIR", "GATEWAY_BODY_LOG_DAYS"):
        os.environ.pop(k, None)
    if log_dir:
        os.environ["GATEWAY_BODY_LOG_DIR"] = log_dir
    if days:
        os.environ["GATEWAY_BODY_LOG_DAYS"] = str(days)
    return tt.gateway("")


def records(log_dir):
    out = []
    for p in sorted(glob.glob(os.path.join(log_dir, "bodies-*.jsonl"))):
        with open(p, encoding="utf-8") as f:
            out += [json.loads(line) for line in f if line.strip()]
    return out


def test_request_and_reply_are_logged_with_the_key_fingerprint_not_the_key():
    d = os.path.join(tempfile.mkdtemp(), "logs")
    port = gateway(d)
    status, _ = tt.post(port, {"model": "m1", "messages": [{"role": "user", "content": "Apa itu magnet?"}]})
    assert status == 200
    (r,) = records(d)
    assert r["request"]["messages"][0]["content"] == "Apa itu magnet?"
    assert r["reply"]["choices"][0]["message"]["content"] == "hi"
    assert r["status"] == "ok" and r["httpStatus"] == 200 and r["path"] == "/v1/chat/completions"
    assert len(r["key"]) == 8 and tt.KEY not in json.dumps(r)
    (f,) = glob.glob(os.path.join(d, "bodies-*.jsonl"))
    assert stat.S_IMODE(os.stat(f).st_mode) == 0o600


def test_a_stream_is_logged_as_the_joined_text():
    d = tempfile.mkdtemp()
    port = gateway(d)
    status, body = tt.post(port, {"model": "m1", "stream": True, "messages": []})
    assert status == 200 and b"Hello" in body
    (r,) = records(d)
    assert r["reply"]["content"] == "Hello there!" and r["reply"]["finish_reason"] == "stop"


def test_inline_images_are_replaced_by_their_hash():
    d = tempfile.mkdtemp()
    port = gateway(d)
    img = "data:image/png;base64," + "QUJD" * 1000
    msg = {"role": "user", "content": [{"type": "text", "text": "gambar apa ini"}, {"type": "image_url", "image_url": {"url": img}}]}
    tt.post(port, {"model": "m1", "messages": [msg]})
    (r,) = records(d)
    part = r["request"]["messages"][0]["content"][1]["image_url"]["url"]
    assert part["redacted"] == "data:image/png;base64" and part["base64Bytes"] == 4000 and len(part["sha256"]) == 64
    assert "QUJDQUJD" not in json.dumps(r)


def test_upstream_errors_are_logged_with_their_body():
    d = tempfile.mkdtemp()
    port = gateway(d)
    status, _ = tt.post(port, {"model": "broken", "messages": []})
    assert status == 500
    (r,) = records(d)
    assert r["status"] == "error" and r["httpStatus"] == 500 and r["reply"]["error"]["message"] == "boom"


def test_files_older_than_the_retention_are_deleted():
    d = tempfile.mkdtemp()
    old = os.path.join(d, "bodies-2000-01-01.jsonl")
    open(old, "w").close()
    t = time.time() - 3 * 86400
    os.utime(old, (t, t))
    keep = os.path.join(d, "notes.txt")  # not a body log: never touched
    open(keep, "w").close()
    os.utime(keep, (t, t))
    port = gateway(d, days=2)
    tt.post(port, {"model": "m1", "messages": []})
    assert not os.path.exists(old) and os.path.exists(keep) and len(records(d)) == 1


def test_logging_is_off_unless_configured_and_a_broken_dir_never_breaks_a_request():
    port = gateway("")
    assert tt.post(port, {"model": "m1", "messages": []})[0] == 200
    blocker = os.path.join(tempfile.mkdtemp(), "file")
    open(blocker, "w").close()
    port = gateway(os.path.join(blocker, "logs"))  # its parent is a file
    status, body = tt.post(port, {"model": "m1", "messages": []})
    assert status == 200 and b"usage" in body


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"{len(tests)} tests ok")
