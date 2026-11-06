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
  # Merge on CPU: no GPU needed, and loading a large base onto the GB10 can OOM
  # under sm_121. CPU-only is reliable for any model size/architecture.
  # CPU-only, enforced two ways. CUDA_VISIBLE_DEVICES alone is NOT enough: the
  # base loads on CPU, but peft then picks its own device for the adapter
  # weights and loads them onto the GPU — which on the GB10, with vLLM already
  # holding most of the card, dies with "CUDA error: out of memory" seconds in.
  # It reads like the merge is too big for the box; it is not, it just never
  # belonged on the GPU. `device_map={"": "cpu"}` pins the adapter too.
  CUDA_VISIBLE_DEVICES="" "$PY" - "$ADIR" "$BASE" "$OUT" >&2 <<'PYEOF'
import sys, torch
from peft import PeftModel
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer
adapter, base_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
# A vision-language base (config.json has vision_config) must be loaded as an image-text model and saved
# with its processor; AutoModelForCausalLM would drop the vision tower or fail on e.g. Qwen3-VL / Gemma-3.
is_vl = getattr(AutoConfig.from_pretrained(base_id), "vision_config", None) is not None
if is_vl:
    from transformers import AutoModelForImageTextToText, AutoProcessor
    base = AutoModelForImageTextToText.from_pretrained(base_id, dtype=torch.float16, device_map={"": "cpu"})
else:
    base = AutoModelForCausalLM.from_pretrained(base_id, dtype=torch.float16, device_map={"": "cpu"})
merged = PeftModel.from_pretrained(base, adapter, device_map={"": "cpu"}).merge_and_unload()
merged.save_pretrained(out, safe_serialization=True)
if is_vl:
    try:
        AutoProcessor.from_pretrained(adapter).save_pretrained(out)
    except Exception:
        AutoProcessor.from_pretrained(base_id).save_pretrained(out)
AutoTokenizer.from_pretrained(adapter).save_pretrained(out)
print("merged ->", out, "| vision-language:", is_vl)
PYEOF
fi
echo "$OUT"
