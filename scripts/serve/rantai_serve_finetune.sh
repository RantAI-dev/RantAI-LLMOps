#!/bin/bash
# NQR: serve a fine-tune (by train job id) via Ollama.
# Usage: rantai_serve_finetune.sh <jobId> <base_model_hf_id> <ollama_tag>
# Resolves the adapter dir saved by the train job, then merges+converts+imports.
# Invoked by the app's export endpoint via wsl.exe.
set -e
JOB="$1"; BASE="$2"; TAG="$3"
if [ -z "$JOB" ] || [ -z "$BASE" ] || [ -z "$TAG" ]; then
  echo "usage: rantai_serve_finetune.sh <jobId> <base_model> <tag>"; exit 2
fi
ADIR=$(find "$HOME/.transformerlab/orgs" -path "*jobs/$JOB/models/*" -name adapter_config.json -printf '%h\n' 2>/dev/null | head -1)
if [ -z "$ADIR" ]; then
  echo "ADAPTER_NOT_FOUND for job $JOB"; exit 3
fi
echo "adapter: $ADIR"
exec bash "$HOME/rantai_export_gguf.sh" "$ADIR" "$BASE" "$TAG"
