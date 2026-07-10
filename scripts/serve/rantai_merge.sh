#!/bin/bash
# Merge a fine-tune (by train job id) into its fp16 base for LOCAL evaluation.
# No GGUF/Ollama — just a merged HF model dir the lm-eval harness can load via
# its `model_path` param (it can't evaluate a LoRA adapter pulled from HF).
# Prints the absolute path of the merged dir on the LAST line.
set -e
JOB="$1"; BASE="$2"; NAME="$3"
if [ -z "$JOB" ] || [ -z "$BASE" ] || [ -z "$NAME" ]; then
  echo "usage: rantai_merge.sh <jobId> <base_model> <name>" >&2; exit 2
fi
PY="$HOME/.transformerlab/envs/transformerlab/bin/python"
ADIR=$(find "$HOME/.transformerlab/orgs" -path "*jobs/$JOB/models/*" -name adapter_config.json -printf '%h\n' 2>/dev/null | head -1)
if [ -z "$ADIR" ]; then echo "ADAPTER_NOT_FOUND for job $JOB" >&2; exit 3; fi
OUT="$HOME/.transformerlab/rantai_merged/$NAME"

if [ ! -f "$OUT/config.json" ]; then
  "$PY" - "$ADIR" "$BASE" "$OUT" >&2 <<'PYEOF'
import sys, torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
adapter, base_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
base = AutoModelForCausalLM.from_pretrained(base_id, dtype=torch.float16)
PeftModel.from_pretrained(base, adapter).merge_and_unload().save_pretrained(out, safe_serialization=True)
AutoTokenizer.from_pretrained(adapter).save_pretrained(out)
print("merged ->", out)
PYEOF
fi
echo "$OUT"
