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


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            out = subprocess.run(QUERY, capture_output=True, text=True, timeout=5)
            payload = {
                "available": out.returncode == 0,
                "csv": out.stdout if out.returncode == 0 else "",
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
