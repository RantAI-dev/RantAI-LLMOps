"""
vllm-serve — a Transformer Lab task that serves a base model + multiple LoRA
adapters over vLLM's OpenAI-compatible API, and stays running so the LLMOps app
can point the gateway / Playground at it.

This is the PORTABLE "Deploy vLLM" backend: it runs through TL's compute provider
(local venv, GPU host) exactly like the trainer — no Portainer / docker.sock, so
it works wherever TL runs. It extends the stock `interactive-vllm` example with
multi-LoRA (--enable-lora + --lora-modules) and runtime adapter hot-swapping.

Config is read from environment variables (the launcher passes them in
`env_vars`), so the plugin needs no TL-specific SDK to run:
  MODEL_NAME              base model (HF id or local path)          [required]
  VLLM_SERVED_NAME        served name for the base                  [base]
  VLLM_PORT               port to serve on                          [8001]
  VLLM_GPU_UTIL           --gpu-memory-utilization                  [0.30]
  VLLM_MAX_MODEL_LEN      --max-model-len                           [8192]
  VLLM_QUANT              --quantization (empty = none)             []
  VLLM_LORA_MODULES       space-sep "name=path" pairs (empty = none)[]
  VLLM_MAX_LORAS          --max-loras                               [4]
  VLLM_MAX_LORA_RANK      --max-lora-rank                           [16]
  HF_TOKEN                for gated bases                           []
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import time
import urllib.request
import urllib.error

VLLM_LOG = pathlib.Path("/tmp/vllm-serve.log")
CHECK_INTERVAL = 5


def _env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    return v if v not in (None, "") else default


def _build_args() -> list[str]:
    model = _env("MODEL_NAME")
    if not model:
        print("FATAL: MODEL_NAME is required", file=sys.stderr, flush=True)
        sys.exit(2)
    port = _env("VLLM_PORT", "8001")
    args = [
        "-m", "vllm.entrypoints.openai.api_server",
        "--model", model,
        "--served-model-name", _env("VLLM_SERVED_NAME", "base"),
        "--host", "0.0.0.0",
        "--port", port,
        "--gpu-memory-utilization", _env("VLLM_GPU_UTIL", "0.30"),
        "--max-model-len", _env("VLLM_MAX_MODEL_LEN", "8192"),
        "--enforce-eager",
        "--max-num-seqs", "16",
        "--trust-remote-code",
    ]
    quant = _env("VLLM_QUANT")
    if quant:
        args += ["--quantization", quant]
    lora = _env("VLLM_LORA_MODULES")
    if lora:
        args += ["--enable-lora", "--max-loras", _env("VLLM_MAX_LORAS", "4"),
                 "--max-lora-rank", _env("VLLM_MAX_LORA_RANK", "16"), "--lora-modules"]
        args += [tok for tok in lora.split() if tok]  # ask=/path learn=/path …
    return args


def _wait_ready(port: str, proc: subprocess.Popen, timeout_s: int = 900) -> bool:
    """Poll /v1/models until the server answers, or the process dies."""
    url = f"http://127.0.0.1:{port}/v1/models"
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=4) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(4)
    return False


def main() -> None:
    args = _build_args()
    # Prefer the plugin venv's python; fall back to the current interpreter.
    py = os.path.expanduser("~/vllm-venv/bin/python")
    if not os.path.exists(py):
        py = sys.executable
    env = os.environ.copy()
    # Allow the app's Adapters page to hot load/unload LoRA at runtime.
    env["VLLM_ALLOW_RUNTIME_LORA_UPDATING"] = "True"

    port = _env("VLLM_PORT", "8001")
    VLLM_LOG.parent.mkdir(parents=True, exist_ok=True)
    log = open(VLLM_LOG, "w", encoding="utf-8")
    print(f"[vllm-serve] starting: {py} {' '.join(args)}", flush=True)
    proc = subprocess.Popen([py, "-u", *args], stdout=log, stderr=subprocess.STDOUT, env=env)

    if _wait_ready(port, proc):
        print(f"[vllm-serve] READY on :{port} — serving {_env('VLLM_SERVED_NAME','base')}"
              + (f" + adapters [{_env('VLLM_LORA_MODULES')}]" if _env("VLLM_LORA_MODULES") else ""), flush=True)
    else:
        print("[vllm-serve] ERROR: server did not become ready", file=sys.stderr, flush=True)
        try:
            print(VLLM_LOG.read_text(encoding="utf-8", errors="replace")[-4000:], file=sys.stderr, flush=True)
        except Exception:
            pass
        sys.exit(1)

    # Stay alive: stream new log lines + watch the process. The task keeps
    # RUNNING (TL tracks it as a live job) until stopped by the app.
    offset = 0
    last = time.monotonic()
    while True:
        try:
            with VLLM_LOG.open("r", encoding="utf-8", errors="replace") as h:
                h.seek(offset)
                chunk = h.read()
                offset = h.tell()
        except FileNotFoundError:
            chunk = ""
        if chunk:
            for line in chunk.splitlines():
                print(f"[vllm] {line}", flush=True)
        now = time.monotonic()
        if now - last >= CHECK_INTERVAL:
            last = now
            rc = proc.poll()
            if rc is not None:
                print(f"[vllm-serve] vLLM exited (code {rc})", file=sys.stderr, flush=True)
                sys.exit(rc or 1)
        if not chunk:
            time.sleep(0.5)


if __name__ == "__main__":
    main()
