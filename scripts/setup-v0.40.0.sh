#!/bin/bash
# One-shot setup for NQRust-LLMOps on Transformer Lab v0.40.0 (run from source).
#
# PREREQUISITES (manual, heavy — see docs/SETUP.md):
#   - WSL2 Ubuntu + NVIDIA CUDA-for-WSL
#   - Transformer Lab installed from source at ~/.transformerlab/src
#     with the conda env ~/.transformerlab/envs/transformerlab (torch+CUDA)
#   - A TL API key + your team id (create via the TL API: POST /auth/api-keys)
#
# This script does the NQR-specific wiring on top of that. Idempotent.
#
# Usage (from WSL, inside the repo):
#   TL_KEY=tl-xxxx TL_TEAM=<team-uuid> bash scripts/setup-v0.40.0.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TL_URL="${TL_URL:-http://localhost:8339}"
PY="$HOME/.transformerlab/envs/transformerlab/bin/python"

echo "== 1) patch TL sandbox for WSL (bwrap/resolv.conf) =="
PY="$PY" bash "$HERE/setup/apply-sandbox-patch.sh"

echo "== 1b) add server-side chat conversations router to TL source =="
PY="$PY" bash "$HERE/setup/apply-conversations.sh"

echo "== 2) install Ollama (userspace) =="
bash "$HERE/setup/install-ollama.sh"

echo "== 3) install serve-fine-tune scripts into \$HOME =="
cp "$HERE/serve/rantai_export_gguf.sh" "$HOME/rantai_export_gguf.sh"
cp "$HERE/serve/rantai_serve_finetune.sh" "$HOME/rantai_serve_finetune.sh"
cp "$HERE/serve/rantai_merge.sh" "$HOME/rantai_merge.sh"
chmod +x "$HOME/rantai_export_gguf.sh" "$HOME/rantai_serve_finetune.sh" "$HOME/rantai_merge.sh"
echo "  installed ~/rantai_export_gguf.sh, ~/rantai_serve_finetune.sh, ~/rantai_merge.sh"

echo "== 4) start backends (TL :8339 + Ollama :11434) =="
bash "$HERE/start-all.sh" || true
# give the TL API a moment
for i in $(seq 1 30); do curl -s --max-time 2 "$TL_URL/" >/dev/null 2>&1 && break; sleep 3; done

if [ -n "$TL_KEY" ] && [ -n "$TL_TEAM" ]; then
  H=(-H "Authorization: Bearer $TL_KEY" -H "X-Team-Id: $TL_TEAM")
  echo "== 5) create experiments (nqr-ft, nqr-eval) =="
  curl -s "${H[@]}" "$TL_URL/experiment/create?name=nqr-ft"   >/dev/null || true
  curl -s "${H[@]}" "$TL_URL/experiment/create?name=nqr-eval" >/dev/null || true
  echo "  ok"
  echo "== 6) raise team quota (self-host, no cloud cost) =="
  curl -s -X PATCH "${H[@]}" -H "Content-Type: application/json" \
    "$TL_URL/quota/team/$TL_TEAM" -d '{"monthly_quota_minutes":5000000}' >/dev/null || true
  echo "  ok"
else
  echo "== 5-6) SKIPPED (set TL_KEY and TL_TEAM to create experiments + raise quota) =="
fi

echo "== 7) pull a default chat model (qwen2.5:0.5b) =="
curl -s http://localhost:11434/api/pull -d '{"model":"qwen2.5:0.5b","stream":false}' >/dev/null || true
echo "  ok"

echo ""
echo "Setup done. In .env.local set:"
echo "  INFERENCE_BASE_URL=$TL_URL/v1"
echo "  INFERENCE_API_KEY=<your TL key>"
echo "  INFERENCE_TEAM_ID=<your team id>"
echo "  OLLAMA_BASE_URL=http://localhost:11434"
echo "  INFERENCE_MODEL=qwen2.5:0.5b"
echo "Then on Windows: npm run dev"
