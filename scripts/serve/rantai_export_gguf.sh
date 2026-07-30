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
MF=$(mktemp)
# Ollama does NOT reliably translate a GGUF's embedded Jinja `tokenizer.chat_template`
# into its own Go template for non-standard archs (e.g. Apertus) — it silently falls
# back to `TEMPLATE {{ .Prompt }}` (passthrough), so the model is served WITHOUT its
# chat markers (<|user_start|>…<|assistant_start|>) and behaves erratically. Derive an
# explicit Ollama TEMPLATE + stop tokens from the merged tokenizer's own chat template
# so every model (Apertus/Qwen/Llama/…) is served in the exact format it was trained on.
"$PY" - "$MERGED" "$GGUF" "$MF" <<'PYMF'
import sys, re
from transformers import AutoTokenizer
merged, gguf, mfpath = sys.argv[1], sys.argv[2], sys.argv[3]
lines = ["FROM " + gguf]
try:
    tok = AutoTokenizer.from_pretrained(merged)
    if not getattr(tok, "chat_template", None):
        raise RuntimeError("merged tokenizer has no chat_template")
    # Probe the tokenizer's own chat template with sentinels, then read off the exact
    # wrapper strings around system / user / assistant content.
    S, U, A = "%%NQRSYS%%", "%%NQRUSR%%", "%%NQRASST%%"
    a = tok.apply_chat_template([{"role": "user", "content": U}],
                                tokenize=False, add_generation_prompt=True)
    b = tok.apply_chat_template([{"role": "system", "content": S}, {"role": "user", "content": U}],
                                tokenize=False, add_generation_prompt=True)
    c = tok.apply_chat_template([{"role": "user", "content": U}, {"role": "assistant", "content": A}],
                                tokenize=False, add_generation_prompt=False)
    iu = a.index(U)
    user_pre, user_to_asst = a[:iu], a[iu + len(U):]
    isys, iu2 = b.index(S), b.index(U)
    sys_pre, sys_to_user = b[:isys], b[isys + len(S):iu2]
    asst_end = c[c.index(A) + len(A):]
    # llama.cpp/Ollama auto-prepends BOS iff the tokenizer does (GGUF add_bos_token).
    # If so, a BOS left inside the TEMPLATE would DOUBLE it -> off-distribution garbage
    # (empirically: on-topic questions get refused). Strip a leading BOS from the
    # wrapper pieces and let the runtime add it exactly once. Kept conditional so models
    # that do NOT auto-add BOS still get it from the template.
    bos = tok.bos_token or ""
    auto_bos = False
    if bos and tok.bos_token_id is not None:
        try:
            ids = tok("probe", add_special_tokens=True)["input_ids"]
            auto_bos = bool(ids) and ids[0] == tok.bos_token_id
        except Exception:
            auto_bos = False
    if auto_bos:
        if sys_pre.startswith(bos):
            sys_pre = sys_pre[len(bos):]
        if user_pre.startswith(bos):
            user_pre = user_pre[len(bos):]
    tmpl = ("{{ if .System }}" + sys_pre + "{{ .System }}" + sys_to_user +
            "{{ else }}" + user_pre + "{{ end }}{{ .Prompt }}" + user_to_asst +
            "{{ .Response }}" + asst_end)
    if "{{ .Prompt }}" not in tmpl or not user_to_asst.strip():
        raise RuntimeError("derived template looks degenerate")
    lines.append('TEMPLATE """' + tmpl + '"""')
    # Stop on every structural marker (+ EOS) so generation halts at the turn boundary
    # instead of running on / hallucinating the next turn.
    stops = re.findall(r"<[^>\s]+>", sys_pre + sys_to_user + user_pre + user_to_asst + asst_end)
    if tok.eos_token:
        stops.append(tok.eos_token)
    seen = set()
    for s in stops:
        if s and s not in seen:
            seen.add(s)
            lines.append("PARAMETER stop " + s)
    sys.stderr.write("[export] derived Ollama TEMPLATE + %d stop tokens\n" % len(seen))
except Exception as e:
    sys.stderr.write("[export] WARNING: could not derive chat TEMPLATE (%s); serving "
                     "FROM-only — chat formatting may be wrong\n" % e)
open(mfpath, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PYMF
ollama create "$TAG" -f "$MF"
echo "OK: $TAG ready in Ollama"
