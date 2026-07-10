#!/bin/bash
# NQR: serve a fine-tuned LoRA via Ollama.
# Usage: rantai_export_gguf.sh <adapter_dir> <base_model_hf_id> <ollama_tag> [outtype]
# Merges adapter into the fp16 base (peft), converts to GGUF (llama.cpp),
# then 'ollama create' so it becomes a chattable Ollama model.
set -e
ADIR="$1"; BASE="$2"; TAG="$3"; OUTTYPE="${4:-q8_0}"
if [ -z "$ADIR" ] || [ -z "$BASE" ] || [ -z "$TAG" ]; then
  echo "usage: rantai_export_gguf.sh <adapter_dir> <base_model> <tag> [outtype]"; exit 2
fi
export PATH="$HOME/.local/bin:$PATH"
PY="$HOME/.transformerlab/envs/transformerlab/bin/python"
PIP="$HOME/.transformerlab/envs/transformerlab/bin/pip"
MERGED="$HOME/.transformerlab/rantai_merged/$TAG"
LCPP="$HOME/.transformerlab/llama.cpp"
GGUF="$MERGED/$TAG.$OUTTYPE.gguf"

echo "[1/4] merge adapter -> fp16 base ($BASE)"
"$PY" - "$ADIR" "$BASE" "$MERGED" <<'PYEOF'
import sys, torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
adapter, base_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
base = AutoModelForCausalLM.from_pretrained(base_id, dtype=torch.float16)
PeftModel.from_pretrained(base, adapter).merge_and_unload().save_pretrained(out, safe_serialization=True)
tok = AutoTokenizer.from_pretrained(adapter)
# The adapter's tokenizer sometimes lacks the chat template. Without it the GGUF
# carries no `tokenizer.chat_template`, so Ollama can't format chat prompts and
# replies come out garbled. Fall back to the base model's chat template.
if not getattr(tok, "chat_template", None):
    tok.chat_template = AutoTokenizer.from_pretrained(base_id).chat_template
tok.save_pretrained(out)
print("merged ->", out, "| chat_template:", "yes" if tok.chat_template else "NO")
PYEOF

echo "[2/4] ensure llama.cpp + gguf"
"$PIP" install -q gguf >/dev/null 2>&1 || true
[ -f "$LCPP/convert_hf_to_gguf.py" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LCPP"

echo "[3/4] convert -> GGUF ($OUTTYPE)"
PYTHONPATH="$LCPP/gguf-py:$PYTHONPATH" "$PY" "$LCPP/convert_hf_to_gguf.py" "$MERGED" --outfile "$GGUF" --outtype "$OUTTYPE"

echo "[4/4] ollama create $TAG"
MF=$(mktemp); printf 'FROM %s\n' "$GGUF" > "$MF"
ollama create "$TAG" -f "$MF"
echo "OK: $TAG ready in Ollama"
