"""Tests for docker/decision/server.py with a fake model: no GPU, no Unsloth.

Run (needs fastapi, httpx, pytest):  cd docker/decision && python -m pytest test_server.py -q
decision_schema.py must be importable; it lives in trainers/unsloth-decision-train/, so this adds it
to the path when run from a checkout. (The Docker image copies it next to server.py.)
"""

import json
import os
import sys
import threading
import time

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "trainers", "unsloth-decision-train"))

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402

QUESTIONS = {
    "team": {"type": "choice", "criteria": {"billing": "tagihan", "technical": "teknis"}},
    "refund": {"type": "noul", "instructions": "Minta refund?"},
    "urgency": {"type": "score", "criteria": ["rendah", "sedang", "tinggi"]},
}
ANSWERS = {
    "team": {"answer": "billing", "choice": "billing", "confidence": 0.99, "probabilities": {"billing": 0.99, "technical": 0.01}},
    "refund": {"answer": True, "noul": 0.97},
    "urgency": {"answer": 2, "score": 1.99, "confidence": 0.9, "probabilities": {"0": 0.0, "1": 0.1, "2": 0.9}},
}

ADMIN = {"x-admin-token": "secret"}


class FakeDecisionDataError(Exception):
    """Named like Unsloth's DecisionDataError, which the server maps by name."""


FakeDecisionDataError.__name__ = "DecisionDataError"


def model_dir(root, name="m1"):
    d = root / name
    d.mkdir()
    (d / "joint_head_config.json").write_text("{}")
    return str(d)


@pytest.fixture
def env(tmp_path):
    root = tmp_path / "models"
    root.mkdir()
    calls = []
    state = {"fail_load": False, "raise": None, "delay": 0.0, "active": 0, "peak": 0}

    def loader(path, in4, seq):
        if state["fail_load"]:
            raise RuntimeError("out of memory")
        return {"path": path}, object()

    def predictor(model, processor, st, questions):
        state["active"] += 1
        state["peak"] = max(state["peak"], state["active"])
        try:
            time.sleep(state["delay"])
            if state["raise"]:
                raise state["raise"]
            calls.append((model["path"], st, sorted(questions)))
            return dict(ANSWERS)
        finally:
            state["active"] -= 1

    reg = server.Registry(loader=loader, predictor=predictor, free=lambda: None,
                          state_file=str(tmp_path / "state" / "models.json"), roots=[str(root)], max_models=2)
    app = server.create_app(reg, admin_token="secret", max_state_chars=500)
    client = TestClient(app)
    return type("Env", (), {"root": root, "reg": reg, "client": client, "calls": calls, "state": state,
                            "tmp": tmp_path, "app": app})


def serve(env, name="decision-a", d="m1"):
    path = model_dir(env.root, d)
    r = env.client.post("/admin/models", headers={"x-admin-token": "secret"}, json={"name": name, "path": path})
    assert r.status_code == 201, r.text
    return path


def ask(env, **over):
    body = {"model": "decision-a", "state": "Saya ditagih dua kali.", "questions": QUESTIONS, **over}
    return env.client.post("/v1/systemone", json=body)


def test_health_and_models_start_empty(env):
    assert env.client.get("/health").json()["models"] == []
    assert env.client.get("/v1/models").json() == {"object": "list", "data": []}


def test_answers_a_request(env):
    path = serve(env)
    r = ask(env)
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "decision-a"
    assert body["answers"]["team"]["choice"] == "billing"
    assert body["answers"]["refund"]["noul"] == 0.97
    assert body["usage"]["output_tokens"] == 0
    assert r.headers["x-decision-backend"] == "pytorch"
    assert env.calls == [(os.path.realpath(path), "Saya ditagih dua kali.", ["refund", "team", "urgency"])]
    assert env.client.get("/v1/models").json()["data"][0]["id"] == "decision-a"


def test_json_state_is_accepted(env):
    serve(env)
    assert ask(env, state={"ticket": "tidak bisa login"}).status_code == 200


def test_unknown_model_is_404(env):
    r = ask(env, model="nope")
    assert r.status_code == 404 and r.json()["error"]["type"] == "model_not_found"


@pytest.mark.parametrize("over,needle", [
    ({"questions": {}}, "non-empty"),
    ({"questions": {"q": {"type": "rank"}}}, "type must be one of"),
    ({"questions": {"q": {"type": "choice", "criteria": ["only"]}}}, "2 to 255 options"),
    ({"state": "   "}, "`state`"),
    ({"state": 5}, "`state`"),
    ({"state": "x" * 501}, "at most 500"),
    ({"model": ""}, "`model` is required"),
    ({"extra": 1}, "unknown field"),
    ({"images": ["data:image/png;base64,AAAA"]}, "text only"),
])
def test_bad_requests_are_422_and_say_why(env, over, needle):
    serve(env)
    r = ask(env, **over)
    assert r.status_code == 422, r.text
    assert needle in r.json()["error"]["message"]


def test_non_json_body_is_400(env):
    r = env.client.post("/v1/systemone", content=b"{nope", headers={"content-type": "application/json"})
    assert r.status_code == 400


def test_decision_data_error_is_the_callers_422(env):
    serve(env)
    env.state["raise"] = FakeDecisionDataError("options exceed the 4096-token context")
    r = ask(env)
    assert r.status_code == 422 and "options exceed" in r.json()["error"]["message"]


def test_other_failures_are_500(env):
    serve(env)
    env.state["raise"] = RuntimeError("CUDA error")
    r = ask(env)
    assert r.status_code == 500 and r.json()["error"]["type"] == "internal_error"


def test_requests_to_one_model_never_overlap(env):
    serve(env)
    env.state["delay"] = 0.05
    results = []

    def go():
        results.append(ask(env).status_code)

    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results == [200] * 6
    assert env.state["peak"] == 1


# ── admin ──
def test_admin_is_disabled_without_a_token(env):
    app = server.create_app(env.reg, admin_token="")
    r = TestClient(app).get("/admin/models")
    assert r.status_code == 403 and r.json()["error"]["type"] == "admin_disabled"


def test_admin_needs_the_right_token(env):
    assert env.client.get("/admin/models").status_code == 401
    assert env.client.get("/admin/models", headers={"x-admin-token": "wrong"}).status_code == 401
    assert env.client.get("/admin/models", headers={"x-admin-token": "secret"}).status_code == 200


def test_admin_refuses_paths_outside_the_roots_or_without_a_model(env):
    h = {"x-admin-token": "secret"}
    outside = env.tmp / "elsewhere"
    outside.mkdir()
    (outside / "joint_head_config.json").write_text("{}")
    r = env.client.post("/admin/models", headers=h, json={"name": "a", "path": str(outside)})
    assert r.status_code == 400 and "outside the allowed" in r.json()["error"]["message"]
    empty = env.root / "empty"
    empty.mkdir()
    r = env.client.post("/admin/models", headers=h, json={"name": "a", "path": str(empty)})
    assert r.status_code == 400 and "not a decision model" in r.json()["error"]["message"]
    # a ".." path must not escape the root
    r = env.client.post("/admin/models", headers=h, json={"name": "a", "path": str(env.root / ".." / "elsewhere")})
    assert r.status_code == 400


def test_admin_validates_name_and_duplicates_and_capacity(env):
    h = {"x-admin-token": "secret"}
    p1, p2, p3 = (model_dir(env.root, n) for n in ("a", "b", "c"))
    assert env.client.post("/admin/models", headers=h, json={"name": "bad name!", "path": p1}).status_code == 400
    assert env.client.post("/admin/models", headers=h, json={"name": "one", "path": p1}).status_code == 201
    assert env.client.post("/admin/models", headers=h, json={"name": "one", "path": p2}).status_code == 409
    assert env.client.post("/admin/models", headers=h, json={"name": "two", "path": p2}).status_code == 201
    r = env.client.post("/admin/models", headers=h, json={"name": "three", "path": p3})
    assert r.status_code == 409 and "at most 2" in r.json()["error"]["message"]


def test_a_load_failure_is_reported_and_leaves_nothing_behind(env):
    env.state["fail_load"] = True
    p = model_dir(env.root)
    r = env.client.post("/admin/models", headers={"x-admin-token": "secret"}, json={"name": "a", "path": p})
    assert r.status_code == 500 and "out of memory" in r.json()["error"]["message"]
    assert env.client.get("/v1/models").json()["data"] == []
    env.state["fail_load"] = False  # the name is free again
    assert env.client.post("/admin/models", headers={"x-admin-token": "secret"}, json={"name": "a", "path": p}).status_code == 201


def test_unload_frees_the_name(env):
    serve(env)
    h = {"x-admin-token": "secret"}
    assert env.client.delete("/admin/models/decision-a", headers=h).json() == {"unloaded": "decision-a"}
    assert ask(env).status_code == 404
    assert env.client.delete("/admin/models/decision-a", headers=h).status_code == 404


def test_the_served_set_survives_a_restart(env):
    path = serve(env)
    saved = json.loads((env.tmp / "state" / "models.json").read_text())
    assert saved == [{"name": "decision-a", "path": os.path.realpath(path), "load_in_4bit": False, "max_seq_length": 4096}]
    fresh = server.Registry(loader=lambda p, a, b: ({"path": p}, object()), predictor=env.reg.predictor,
                            free=lambda: None, state_file=str(env.tmp / "state" / "models.json"),
                            roots=[str(env.root)], max_models=2)
    fresh.restore()
    assert fresh.ready and list(fresh.models) == ["decision-a"]


def test_restore_skips_a_broken_entry_and_keeps_the_rest(env):
    good = model_dir(env.root, "good")
    state_file = env.tmp / "state" / "models.json"
    state_file.parent.mkdir(exist_ok=True)
    state_file.write_text(json.dumps([
        {"name": "gone", "path": str(env.root / "missing")},
        {"name": "good", "path": good},
    ]))
    fresh = server.Registry(loader=lambda p, a, b: ({"path": p}, object()), predictor=env.reg.predictor,
                            free=lambda: None, state_file=str(state_file), roots=[str(env.root)], max_models=3)
    fresh.restore(extra=[{"name": "good", "path": good}])  # a duplicate name is loaded once
    assert fresh.ready
    assert fresh.models["good"].model is not None
    # The broken one stays visible (unloaded, with the reason) instead of vanishing...
    assert fresh.models["gone"].model is None and "not loaded at start" in fresh.models["gone"].error
    # ...and stays remembered, so a later restart (with the path back) serves it again.
    assert sorted(e["name"] for e in json.loads(state_file.read_text())) == ["gone", "good"]


def test_restore_survives_malformed_entries(env):
    state_file = env.tmp / "state" / "models.json"
    state_file.parent.mkdir(exist_ok=True)
    state_file.write_text(json.dumps([{"name": 123, "path": "x"}, {"name": "p", "path": 5}, {"name": "q", "path": "/x",
                                      "max_seq_length": "abc"}, "junk"]))
    fresh = server.Registry(loader=env.reg.loader, predictor=env.reg.predictor, free=lambda: None,
                            state_file=str(state_file), roots=[str(env.root)], max_models=3)
    fresh.restore(extra={"not": "a list"})
    assert fresh.ready
    assert all(s.model is None for s in fresh.models.values())


def test_ready_is_503_until_restored(env):
    env.reg.ready = False
    assert env.client.get("/ready").status_code == 503
    assert env.client.get("/health").status_code == 200  # liveness stays up
    env.reg.ready = True
    assert env.client.get("/ready").status_code == 200


def test_a_failed_restore_entry_can_be_unloaded_and_redeployed(env):
    path = model_dir(env.root, "back")
    failed = server.Served("back", path, False, 4096)
    failed.error = "not loaded at start: boom"
    env.reg.models["back"] = failed
    assert env.client.post("/v1/systemone", json={"model": "back", "state": "x", "questions": QUESTIONS}).status_code == 404
    r = env.client.post("/admin/models", headers=ADMIN, json={"name": "back", "path": path})
    assert r.status_code == 201 and env.reg.models["back"].model is not None


def test_oversized_body_is_413(env):
    model_dir(env.root, "m")
    env.client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": str(env.root / "m")})
    big = {"model": "m", "state": "x", "questions": QUESTIONS, "pad": "y" * (9 * 1024 * 1024)}
    assert env.client.post("/v1/systemone", content=json.dumps(big), headers={"content-type": "application/json"}).status_code == 413


def test_deeply_nested_json_is_400_not_500(env):
    body = "[" * 100000 + "]" * 100000
    assert env.client.post("/v1/systemone", content=body, headers={"content-type": "application/json"}).status_code == 400


def test_internal_errors_do_not_leak_detail(env):
    model_dir(env.root, "m")
    env.client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": str(env.root / "m")})
    env.state["raise"] = RuntimeError("CUDA error at /secret/path/kernel.cu:42")
    r = env.client.post("/v1/systemone", json={"model": "m", "state": "x", "questions": QUESTIONS})
    assert r.status_code == 500 and "/secret/path" not in r.text


def test_failed_load_frees_memory(env):
    freed = []
    env.reg.free = lambda: freed.append(1)
    env.state["fail_load"] = True
    model_dir(env.root, "m")
    r = env.client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": str(env.root / "m")})
    assert r.status_code == 500 and freed


def test_admin_load_rejects_string_booleans_and_numbers(env):
    model_dir(env.root, "m")
    r1 = env.client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": str(env.root / "m"), "load_in_4bit": "false"})
    r2 = env.client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": str(env.root / "m"), "max_seq_length": "x"})
    assert r1.status_code == 422 and r2.status_code == 422


def test_load_refused_when_gpu_memory_is_low(env):
    env.reg.min_free_gb, env.reg.free_gb = 12.0, lambda: 3.5
    model_dir(env.root, "m")
    r = env.client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": str(env.root / "m")})
    assert r.status_code == 507 and "3.5 GB" in r.json()["error"]["message"]
    assert "m" not in env.reg.models and not env.reg._loading


def test_unload_while_loading_is_409(env):
    env.reg._loading.add("busy")
    assert env.client.delete("/admin/models/busy", headers=ADMIN).status_code == 409


def test_long_question_text_is_422(env):
    model_dir(env.root, "m")
    env.client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": str(env.root / "m")})
    q = {"q": {"type": "noul", "instructions": "z" * 5000}}
    assert env.client.post("/v1/systemone", json={"model": "m", "state": "x", "questions": q}).status_code == 422
    q2 = {"q": {"type": "noul", "instructions": 7}}
    assert env.client.post("/v1/systemone", json={"model": "m", "state": "x", "questions": q2}).status_code == 422


def test_a_request_waiting_too_long_for_a_busy_model_is_503(tmp_path):
    root = tmp_path / "models"
    root.mkdir()
    path = model_dir(root, "m")

    def slow(model, processor, st, q):
        time.sleep(1.0)
        return dict(ANSWERS)

    reg = server.Registry(loader=lambda p, a, b: ({"path": p}, object()), predictor=slow, free=lambda: None,
                          roots=[str(root)], max_models=1)
    client = TestClient(server.create_app(reg, admin_token="secret", queue_timeout=0.2))
    client.post("/admin/models", headers=ADMIN, json={"name": "m", "path": path})
    out = []
    ts = [threading.Thread(target=lambda: out.append(client.post("/v1/systemone", json={"model": "m", "state": "x", "questions": QUESTIONS}).status_code)) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == [200, 503]


def test_an_unreadable_state_file_is_ignored(env):
    sf = env.tmp / "state" / "models.json"
    sf.parent.mkdir(exist_ok=True)
    sf.write_text("{not json")
    reg = server.Registry(loader=env.reg.loader, predictor=env.reg.predictor, free=lambda: None,
                          state_file=str(sf), roots=[str(env.root)])
    reg.restore()
    assert reg.ready and reg.models == {}
