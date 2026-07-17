#!/usr/bin/env python3
"""Tiny GPU-stats sidecar for RantAI-LLMOps.

Serves `nvidia-smi` output as JSON so the UI's GPU widget works in a split
frontend/backend Docker deploy: the frontend container has no GPU (and can't
`docker exec` into the backend), but THIS runs inside the backend container,
which does have the GPU + nvidia-smi. The frontend fetches it over the internal
network as http://<backend-service>:8341/ (see GPU_STATS_URL in the compose).

Stdlib only — no extra deps. Best-effort: if nvidia-smi is missing it returns an
empty CSV, and if this whole process dies only the widget is affected, never
training (which runs inside the backend directly).
"""
import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

QUERY = [
    "nvidia-smi",
    "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
    "--format=csv,noheader,nounits",
]

_NA = ("[n/a]", "n/a", "")


def _system_mem_mb():
    """(total, used) system memory in MB — the UNIFIED pool that a GB10 / DGX Spark
    GPU shares with the CPU. Used when nvidia-smi can't report dedicated VRAM."""
    info = {}
    with open("/proc/meminfo", encoding="utf-8") as f:
        for line in f:
            k, _, v = line.partition(":")
            info[k.strip()] = int(v.strip().split()[0])  # kB
    total = info.get("MemTotal", 0) // 1024
    avail = info.get("MemAvailable", info.get("MemFree", 0)) // 1024
    return total, max(0, total - avail)


def _patch_unified_memory(csv):
    """On unified-memory GPUs (GB10 / DGX Spark) nvidia-smi returns memory as
    "[N/A]" because the GPU has no dedicated VRAM — it shares system RAM. Swap in
    the system memory so the UI shows the real (unified) pool instead of 0. Normal
    dedicated-VRAM GPUs report real numbers and are left untouched."""
    total_mb = used_mb = None
    out = []
    for line in csv.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        # fields: index, name, util, mem.used, mem.total, temp, power
        if len(parts) >= 5 and (parts[3].lower() in _NA or parts[4].lower() in _NA):
            if total_mb is None:
                try:
                    total_mb, used_mb = _system_mem_mb()
                except Exception:
                    total_mb, used_mb = 0, 0
            parts[3], parts[4] = str(used_mb), str(total_mb)
            line = ", ".join(parts)
        out.append(line)
    return "\n".join(out) + ("\n" if out else "")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            out = subprocess.run(QUERY, capture_output=True, text=True, timeout=5)
            payload = {
                "available": out.returncode == 0,
                "csv": _patch_unified_memory(out.stdout) if out.returncode == 0 else "",
            }
        except Exception:
            payload = {"available": False, "csv": ""}
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence per-request access logs
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8341), Handler).serve_forever()
