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
# Merge on CPU (CUDA_VISIBLE_DEVICES=""): merging LoRA into the base is just weight
# arithmetic and needs no GPU. Loading a larger base (e.g. 8B) onto the GB10 GPU can
# spuriously OOM under sm_121 (PyTorch has no official >12.0 support) — small models
# fit, big ones don't. CPU-only makes export reliable for any model size/architecture.
CUDA_VISIBLE_DEVICES="" "$PY" - "$ADIR" "$BASE" "$MERGED" <<'PYEOF'
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
# Keep llama.cpp current so its converter recognises newer architectures (e.g.
# Apertus). A clone-once would freeze on an old version that only knows older archs.
if [ -d "$LCPP/.git" ]; then
  git -C "$LCPP" fetch -q --depth 1 origin 2>/dev/null && git -C "$LCPP" reset -q --hard FETCH_HEAD 2>/dev/null || true
else
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LCPP"
fi

echo "[3/4] convert -> GGUF ($OUTTYPE)"
PYTHONPATH="$LCPP/gguf-py:$PYTHONPATH" "$PY" "$LCPP/convert_hf_to_gguf.py" "$MERGED" --outfile "$GGUF" --outtype "$OUTTYPE"

echo "[4/4] ollama create $TAG"
MF=$(mktemp); printf 'FROM %s\n' "$GGUF" > "$MF"
ollama create "$TAG" -f "$MF"
echo "OK: $TAG ready in Ollama"
