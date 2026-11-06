"""Tests for vlm_schema (no GPU, no unsloth). Run: python -m pytest trainers/unsloth-vision-train/test_vlm_schema.py"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vlm_schema import (  # noqa: E402
    dataset_problem,
    is_public_https_url,
    validate_jsonl_text,
    validate_row,
    validate_rows,
)

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "vlm_cases.jsonl")


def exists(path: str) -> bool:
    """The fixture's convention: an image whose path contains "missing" is not in the dataset."""
    return "missing" not in path


def row(text="Q", ref="images/a.jpg", answer="A"):
    return {"messages": [
        {"role": "user", "content": [{"type": "image", "image": ref}, {"type": "text", "text": text}]},
        {"role": "assistant", "content": answer},
    ]}


def fixture_cases():
    with open(FIXTURE, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def test_shared_fixture_with_the_typescript_validator():
    """src/lib/vlm-schema.test.ts reads the same file; the two validators must agree (verdict and reason)."""
    wrong = []
    cases = fixture_cases()
    assert len(cases) > 40
    for n, case in enumerate(cases, 1):
        meta = case if isinstance(case, dict) else {}
        expected = meta.get("_expect", "invalid")
        ok, why = validate_row(case, image_exists=exists)
        if ("valid" if ok else "invalid") != expected:
            wrong.append((n, meta.get("_why"), expected, why))
        elif expected == "invalid" and meta.get("_error") and meta["_error"] not in why:
            wrong.append((n, meta.get("_why"), meta["_error"], why))
        elif expected == "valid" and why != "":
            wrong.append((n, meta.get("_why"), "empty why", why))
    assert not wrong, wrong


def test_max_images_is_configurable():
    r = {"messages": [
        {"role": "user", "content": [{"type": "image", "image": f"images/{i}.png"} for i in range(3)] + [{"type": "text", "text": "Q"}]},
        {"role": "assistant", "content": "A"},
    ]}
    assert validate_row(r)[0]
    ok, why = validate_row(r, max_images=2)
    assert not ok and "at most 2" in why


def test_exists_is_only_asked_for_relative_paths():
    asked = []

    def spy(p):
        asked.append(p)
        return True

    r = {"messages": [
        {"role": "user", "content": [
            {"type": "image", "image": "./images/a.png"},
            {"type": "image", "image": "https://example.com/b.png"},
            {"type": "image", "image": "s3://bkt/c.png"},
            {"type": "text", "text": "Q"}]},
        {"role": "assistant", "content": "A"},
    ]}
    assert validate_row(r, image_exists=spy) == (True, "")
    assert asked == ["images/a.png"]  # normalized: no leading ./


def test_validate_rows_report():
    rows = [row(), row(ref="images/missing.png"), {"messages": []}, "not json", json.dumps(row(ref="images/b.png"))]
    rep = validate_rows(rows, image_exists=exists)
    assert rep["total"] == 5 and rep["valid"] == 2 and rep["invalid"] == 3
    assert rep["invalid_ratio"] == 0.6
    assert rep["images_referenced"] == 3  # a.png, missing.png, b.png (valid or not; the empty row has none)
    assert [p["line"] for p in rep["problems"]] == [2, 3, 4]
    assert rep["problems"][1]["why"] == "messages must be a non-empty array"
    assert rep["problems"][2]["why"] == "not valid JSON"
    assert set(rep) == {"total", "valid", "invalid", "invalid_ratio", "images_referenced", "problems"}


def test_problems_are_capped_at_20():
    rep = validate_rows([{"messages": []}] * 50)
    assert rep["invalid"] == 50 and len(rep["problems"]) == 20


def test_jsonl_text_keeps_real_line_numbers():
    text = "\n".join([json.dumps(row()), "", "oops", json.dumps(row())])
    rep = validate_jsonl_text(text)
    assert rep["total"] == 3 and rep["problems"] == [{"line": 3, "why": "not valid JSON"}]


def test_dataset_problem():
    good = validate_rows([row() for _ in range(30)])
    assert dataset_problem(good) is None
    assert "empty" in dataset_problem(validate_rows([]))
    few = dataset_problem(validate_rows([row() for _ in range(10)]))
    assert "at least 20" in few
    assert dataset_problem(validate_rows([row() for _ in range(10)]), min_rows=5) is None
    # 1 bad row in 60 = 1.7%: allowed. 2 in 60 = 3.3%: not.
    assert dataset_problem(validate_rows([row() for _ in range(59)] + [{"messages": []}])) is None
    msg = dataset_problem(validate_rows([row() for _ in range(58)] + [{"messages": []}] * 2))
    assert "2 of 60" in msg and "line 59" in msg
    assert dataset_problem(validate_rows([row() for _ in range(58)] + [{"messages": []}] * 2), max_invalid_ratio=0.5) is None


def test_public_https_url():
    assert is_public_https_url("https://example.com/a.png")
    for bad in ("http://example.com/a.png", "https://localhost/a.png", "https://10.0.0.5/a.png", "https://[::1]/a.png",
                "https://minio/a.png", "https://x.internal/a.png", "https://u:p@example.com/a.png", "https://exa mple.com/a.png",
                "https://172.20.1.1/a.png", "https://100.64.0.1/a.png", "https://169.254.169.254/latest"):
        assert not is_public_https_url(bad), bad
