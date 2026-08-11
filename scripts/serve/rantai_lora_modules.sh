#!/usr/bin/env bash
# rantai_lora_modules.sh — resolve trained LoRA adapter job ids into the value for
# VLLM_LORA_MODULES (space-separated `name=path` pairs). With that set, the vLLM
# service serves the base AND each adapter, routing per request by the `model`
# name (base / asklearn / practice) — see docker-compose.portainer.yml (vllm).
#
# Run where Transformer Lab's data lives (the TL backend container or host), e.g.:
#   docker exec rantai-backend bash scripts/serve/rantai_lora_modules.sh \
#       asklearn=697036e4 practice=<jobid>
#
# Diagnostics (the name -> dir mapping + each adapter's base) go to stderr; the
# single line on stdout is the VLLM_LORA_MODULES value. Paste it into the vllm
# service env (Portainer) and redeploy. All adapters MUST share one base model,
# and VLLM_MODEL must be that (unmerged) base.
set -euo pipefail

TL_ROOT="${TL_ROOT:-$HOME/.transformerlab}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 name=<jobid> [name2=<jobid2> ...]" >&2
  echo "  e.g. $0 asklearn=697036e4 practice=<jobid>" >&2
  exit 2
fi

out=""
bases=""
for pair in "$@"; do
  case "$pair" in
    *=*) : ;;
    *) echo "bad argument '$pair' (expected name=jobid)" >&2; exit 2 ;;
  esac
  name="${pair%%=*}"
  job="${pair#*=}"
  cfg="$(find "$TL_ROOT/orgs" -path "*jobs/${job}*/models/*" -name adapter_config.json 2>/dev/null | head -1)"
  if [ -z "$cfg" ]; then
    echo "no adapter found for job '$job' under $TL_ROOT/orgs" >&2
    exit 1
  fi
  dir="$(dirname "$cfg")"
  base="$(sed -n 's/.*"base_model_name_or_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" | head -1)"
  echo "  $name -> $dir  (base: ${base:-?})" >&2
  bases="$bases ${base:-?}"
  out="$out $name=$dir"
done

# Warn (don't fail) if the adapters don't all share one base — vLLM needs one base.
uniq_bases="$(printf '%s\n' $bases | sort -u | tr '\n' ' ')"
if [ "$(printf '%s\n' $bases | sort -u | wc -l)" -gt 1 ]; then
  echo "WARNING: adapters have different base models: $uniq_bases" >&2
  echo "         multi-LoRA needs ONE shared base; VLLM_MODEL must equal it." >&2
fi

echo "${out# }"
