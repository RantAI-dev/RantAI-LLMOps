#!/usr/bin/env python3
"""Host-script sidecar for RantAI-LLMOps.

Runs the fine-tune pipeline scripts (merge -> GGUF -> `ollama create`, plus the
nvidia-smi inventory) INSIDE the backend container, so the frontend never needs
`docker exec` — which would require mounting the Docker socket into the UI (a
bind mount + host-Docker control we deliberately avoid; see docker-compose). This
is the export-side complement to gpu-server.py (which serves live GPU stats).

Protocol: POST / with JSON {"cmd": "<full bash command>"}. We run `bash -lc <cmd>`
and stream its merged stdout+stderr back line by line as a plain-text response,
then a trailer line `__RANTAI_EXIT__:<exit-code>` so the caller can tell success
from failure. The frontend's host-runner (HOST_RUNNER=sidecar) speaks exactly
this protocol; see src/lib/host-runner.ts.

Security: listens on the internal Docker network only (no published host port).
As defense-in-depth it also refuses any command that does not invoke one of the
known pipeline scripts (or nvidia-smi). Stdlib only — no extra deps.
"""
import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Only run commands that invoke a known pipeline script (or the GPU inventory).
_ALLOWED = (
    "rantai_merge.sh",
    "rantai_export_gguf.sh",
    "rantai_serve_finetune.sh",
    "nvidia-smi",
)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            cmd = (json.loads(self.rfile.read(length) or b"{}") or {}).get("cmd", "")
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()

        if not cmd or not any(tok in cmd for tok in _ALLOWED):
            self._write("forbidden: command not in the allowed pipeline set\n")
            self._write("__RANTAI_EXIT__:126\n")
            return

        code = 1
        try:
            proc = subprocess.Popen(
                ["bash", "-lc", cmd],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                if not self._write(line):  # client hung up — stop the job
                    proc.kill()
                    return
            code = proc.wait()
        except Exception as exc:  # noqa: BLE001 — surface any launch error to the client
            self._write(f"[export-server] error: {exc}\n")
        self._write(f"__RANTAI_EXIT__:{code}\n")

    def _write(self, text: str) -> bool:
        try:
            self.wfile.write(text.encode("utf-8", "replace"))
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, ValueError):
            return False

    def log_message(self, *args):  # silence per-request access logs
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8342), Handler).serve_forever()
