#!/bin/bash
# Install Ollama into ~/.local (userspace, no sudo) — for WSL where the official
# installer's `sudo ... /usr/local` step is blocked. Idempotent.
set -e
PY="${PY:-$HOME/.transformerlab/envs/transformerlab/bin/python}"
PIP="${PIP:-$HOME/.transformerlab/envs/transformerlab/bin/pip}"
URL="https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst"
TGZ=/tmp/ollama-linux-amd64.tar.zst

if [ -x "$HOME/.local/bin/ollama" ]; then
  echo "ollama already installed: $("$HOME/.local/bin/ollama" --version 2>/dev/null | head -1)"
  exit 0
fi

echo "downloading ollama (~1.3 GB)…"
curl -fL --retry 3 -o "$TGZ" "$URL"

echo "decompressing (python zstandard)…"
"$PIP" install -q zstandard >/dev/null 2>&1 || true
mkdir -p "$HOME/.local"
"$PY" - "$TGZ" "$HOME/.local" <<'PYEOF'
import sys, tarfile, zstandard
src, dest = sys.argv[1], sys.argv[2]
with open(src, "rb") as f:
    with zstandard.ZstdDecompressor().stream_reader(f) as r:
        with tarfile.open(fileobj=r, mode="r|") as t:
            t.extractall(dest)
print("extracted ->", dest)
PYEOF
echo "installed: $HOME/.local/bin/ollama"
