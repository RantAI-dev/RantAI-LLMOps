#!/usr/bin/env bash
#
# apply-fixes.sh — re-apply the Transformer Lab plugin patches NQRust-LLMOps
# relies on, idempotently.
#
# WHEN YOU NEED THIS
#   The patches live under /root/.transformerlab/ which is the named Docker
#   volume `transformerlab_data`. They SURVIVE `docker compose down` + `up`
#   (the volume is reattached). You only lose them on `docker compose down -v`,
#   `docker volume rm`, a volume prune, or a fresh machine. In those cases:
#     1. Start the stack and let the app install the loader/trainer plugins
#        (fastchat_server, llama_cpp_server, llama_trainer, gguf_exporter), then
#     2. run this script:  docker exec -i transformerlab-api bash < apply-fixes.sh
#
# WHY EACH FIX (root causes we hit on transformerlab/api:latest)
#   - `kernels` pkg + transformers 5.x  -> "Either a revision or a version must
#     be specified" on model load/train. We remove the kernels package so
#     transformers falls back.
#   - fastchat needs transformers 4.53.3 (5.x breaks rope config: KeyError
#     'factor').
#   - llama.cpp GGUF worker streams crash on partial-UTF8 tokens -> decode with
#     errors="ignore".
#   - controller needs workspace/logs to exist.
#
# Safe to run multiple times.
set -uo pipefail

ORG_PLUGINS="$(find /root/.transformerlab/orgs -maxdepth 3 -type d -name plugins 2>/dev/null | head -1)"
if [ -z "$ORG_PLUGINS" ]; then
  echo "!! Could not find an org plugins dir — is the app set up (team created)?"
  exit 1
fi
WORKSPACE="$(dirname "$ORG_PLUGINS")"
echo "Plugins dir: $ORG_PLUGINS"

remove_kernels() {
  local venv="$1"
  if [ -d "$venv/lib" ]; then
    rm -rf "$venv"/lib/python*/site-packages/kernels "$venv"/lib/python*/site-packages/kernels-*.dist-info 2>/dev/null
    echo "  - kernels removed from $(basename "$(dirname "$venv")")"
  fi
}

# 1. Remove the broken `kernels` package from every plugin venv.
for plug in fastchat_server llama_cpp_server llama_trainer eleuther-ai-lm-evaluation-harness; do
  remove_kernels "$ORG_PLUGINS/$plug/venv"
done

# 1b. llama_trainer: disable example packing so the model learns per-response
# boundaries (packing concatenates examples and blurs where each answer ends —
# bad for teaching a consistent response style/format).
LT_MAIN="$ORG_PLUGINS/llama_trainer/main.py"
if [ -f "$LT_MAIN" ]; then
  sed -i 's/packing=True,/packing=False,  # NQRUST: per-response boundaries/' "$LT_MAIN"
  echo "  - llama_trainer packing disabled"
fi

# 2. fastchat_server: pin transformers 4.53.3 (5.x breaks Qwen rope config).
FC_VENV="$ORG_PLUGINS/fastchat_server/venv"
if [ -x "$FC_VENV/bin/python" ]; then
  CUR="$("$FC_VENV/bin/python" -c 'import transformers; print(transformers.__version__)' 2>/dev/null)"
  if [ "$CUR" != "4.53.3" ]; then
    echo "  - fastchat transformers $CUR -> 4.53.3"
    UV="$(command -v uv || echo /root/.transformerlab/envs/transformerlab/bin/uv)"
    "$UV" pip install --python "$FC_VENV/bin/python" "transformers==4.53.3" >/dev/null 2>&1 \
      && echo "    done" || echo "    !! transformers pin failed (check uv)"
  else
    echo "  - fastchat transformers already 4.53.3"
  fi
fi

# 3. llama_cpp_server: decode tokens with errors="ignore" (GGUF streaming).
LC_MAIN="$ORG_PLUGINS/llama_cpp_server/main.py"
if [ -f "$LC_MAIN" ]; then
  if grep -q 'decode("utf-8", errors="ignore")' "$LC_MAIN"; then
    echo "  - llama.cpp decode patch already applied"
  else
    sed -i 's/\.decode("utf-8")/.decode("utf-8", errors="ignore")/g' "$LC_MAIN"
    echo "  - llama.cpp decode patch applied"
  fi
fi

# 4. controller log dir.
mkdir -p "$WORKSPACE/logs" && echo "  - workspace/logs ensured"

# 5. gguf_exporter: (a) convert the LOCAL model dir, not the HF model id (avoids
#    a bogus HuggingFace download / 401); (b) fix tokenizer_config.json where a
#    trainer saved extra_special_tokens as a list but transformers wants a dict
#    ('list' object has no attribute 'keys'). Needed to export fine-tuned models.
GE_MAIN="$ORG_PLUGINS/gguf_exporter/main.py"
if [ -f "$GE_MAIN" ]; then
  sed -i 's/input_model = tlab_exporter.params.get("model_name")/input_model = tlab_exporter.params.get("model_path") or tlab_exporter.params.get("model_name")/' "$GE_MAIN"
  python3 - "$GE_MAIN" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = '    print("Quantizing model to 8-bit format...")'
fix = (
    '    # NQRUST_TOKENIZER_FIX: trainers may save extra_special_tokens as a list;\n'
    '    # transformers expects a dict. Normalize so the convert/load works.\n'
    '    import json as _json\n'
    '    _tc = os.path.join(model_path, "tokenizer_config.json")\n'
    '    if os.path.isfile(_tc):\n'
    '        try:\n'
    '            _d = _json.load(open(_tc))\n'
    '            if isinstance(_d.get("extra_special_tokens"), list):\n'
    '                _d["extra_special_tokens"] = {}\n'
    '                _json.dump(_d, open(_tc, "w"), ensure_ascii=False, indent=2)\n'
    '        except Exception:\n'
    '            pass\n'
)
# After conversion, rename the auto-named .gguf to match output_model_id so the
# app can reconstruct <models>/<id>/<id> (TL doesn't set local_path for these).
rename = (
    '    # NQRUST_GGUF_RENAME: name the file == output_model_id for path resolution.\n'
    '    import glob as _glob\n'
    '    _omi = tlab_exporter.params.get("output_model_id")\n'
    '    _gg = _glob.glob(os.path.join(output_dir, "*.gguf"))\n'
    '    if _omi and _gg and os.path.basename(_gg[0]) != _omi:\n'
    '        try:\n'
    '            os.rename(_gg[0], os.path.join(output_dir, _omi))\n'
    '        except Exception:\n'
    '            pass\n'
)
done = '    print("GGUF conversion completed successfully!")'
changed = False
if 'NQRUST_TOKENIZER_FIX' not in s and anchor in s:
    s = s.replace(anchor, fix + anchor, 1)
    changed = True
if 'NQRUST_GGUF_RENAME' not in s and done in s:
    s = s.replace(done, rename + done, 1)
    changed = True
if changed:
    open(p, 'w').write(s)
    print("    patched")
PYEOF
    echo "  - gguf_exporter patched (local path + tokenizer fix)"
fi

echo "Done. Restart the worker (re-load your model in the app) to pick up plugin changes."
