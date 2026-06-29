#!/bin/bash
# Start the two WSL-side backends NQRust-LLMOps needs:
#   - Transformer Lab API (source)  on :8339
#   - Ollama (inference engine)      on :11434
# Run the Next.js app separately on Windows: `npm run dev` (:3000).
#
# Usage (from WSL):  bash scripts/start-all.sh
# Each backend is started in the background; logs go to /tmp.
set -e

# --- Ollama -------------------------------------------------------------------
if curl -s --max-time 2 http://localhost:11434/api/version >/dev/null 2>&1; then
  echo "ollama already up on :11434"
else
  echo "starting ollama on :11434…"
  ( export PATH="$HOME/.local/bin:$PATH"; export OLLAMA_HOST=0.0.0.0:11434; \
    export OLLAMA_KEEP_ALIVE=30m; nohup ollama serve >/tmp/ollama.log 2>&1 & )
fi

# --- Transformer Lab API ------------------------------------------------------
if curl -s --max-time 2 http://localhost:8339/ >/dev/null 2>&1; then
  echo "TL backend already up on :8339"
else
  echo "starting TL backend on :8339…"
  ( export PATH="$HOME/.transformerlab/miniforge3/bin:$PATH"; \
    eval "$(conda shell.bash hook)"; \
    conda activate "$HOME/.transformerlab/envs/transformerlab"; \
    cd "$HOME/.transformerlab/src"; nohup ./run.sh -c -p 8339 >/tmp/tl8339.log 2>&1 & )
fi

echo "done. Now run the app on Windows:  npm run dev"
echo "(logs: /tmp/ollama.log, /tmp/tl8339.log)"
