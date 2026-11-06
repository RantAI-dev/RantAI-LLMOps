"""Tests for the argument builder in run.py (no GPU, no vLLM needed).

    python -m pytest plugins/vllm-serve
"""

import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import run  # noqa: E402

KEYS = [
    "MODEL_NAME", "VLLM_SERVED_NAME", "VLLM_PORT", "VLLM_QUANT", "VLLM_LORA_MODULES",
    "VLLM_LIMIT_MM_IMAGES", "VLLM_MAX_IMAGE_PIXELS",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in KEYS:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("MODEL_NAME", "aisingapore/Qwen-SEA-LION-v4-8B-VL")


def test_no_multimodal_flags_by_default():
    args = run._build_args()
    assert "--limit-mm-per-prompt" not in args
    assert "--mm-processor-kwargs" not in args


def test_multimodal_flags_carry_valid_json(monkeypatch):
    monkeypatch.setenv("VLLM_LIMIT_MM_IMAGES", "4")
    monkeypatch.setenv("VLLM_MAX_IMAGE_PIXELS", "1048576")
    args = run._build_args()
    assert json.loads(args[args.index("--limit-mm-per-prompt") + 1]) == {"image": 4}
    assert json.loads(args[args.index("--mm-processor-kwargs") + 1]) == {"max_pixels": 1048576}


def test_each_flag_is_independent(monkeypatch):
    monkeypatch.setenv("VLLM_LIMIT_MM_IMAGES", "2")
    args = run._build_args()
    assert "--limit-mm-per-prompt" in args
    assert "--mm-processor-kwargs" not in args


def test_lora_modules_stay_last(monkeypatch):
    monkeypatch.setenv("VLLM_LORA_MODULES", "ask=/a learn=/b")
    monkeypatch.setenv("VLLM_LIMIT_MM_IMAGES", "4")
    args = run._build_args()
    assert args[-2:] == ["ask=/a", "learn=/b"]
    assert args[args.index("--lora-modules") + 1:] == ["ask=/a", "learn=/b"]
