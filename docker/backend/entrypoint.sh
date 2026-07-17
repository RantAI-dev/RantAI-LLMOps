#!/bin/bash
# First-run installer for the "install-at-first-run" backend image.
#
# The image itself is small (~3 GB) — it ships the vendored TL source + our
# patches, but NOT the multi-GB conda/torch env. On the very first start, this
# installs that env INTO the named volume mounted at /root/.transformerlab, so:
#   - the image stays small (fits CI/GHCR),
#   - no host ~/.transformerlab mount is needed (named volume, Docker-managed),
#   - the env is built natively for the host's arch (arm64 on the GX10).
# Subsequent starts skip straight to launch.
#
# Trade-off: the first boot takes ~30-40 min and needs internet (to pull conda +
# torch wheels). For an AIRGAPPED host, use docker/backend/Dockerfile instead
# (that one bakes everything at build time — big image, but no runtime download).
set -e

TLAB=/root/.transformerlab
MARK="$TLAB/.rantai-ready"

if [ ! -f "$MARK" ]; then
  echo "[rantai-init] First run — installing Transformer Lab into the volume."
  echo "[rantai-init] This is one-time and takes ~30-40 min (needs internet)."

  # Vendored source -> the volume (strip CRLF from the Windows checkout).
  mkdir -p "$TLAB/src"
  cp -a /opt/rantai/tl-src/. "$TLAB/src/"
  find "$TLAB/src" -name '*.sh' -exec sed -i 's/\r$//' {} +
  chmod +x "$TLAB/src/install.sh" "$TLAB/src/run.sh"

  # Serve/merge/export scripts into $HOME (baked in the image; they read
  # $HOME/.transformerlab at run time).
  cp /opt/rantai/serve/rantai_*.sh /root/ && chmod +x /root/rantai_*.sh

  cd "$TLAB/src"
  # A real GPU IS visible at run time (--gpus), so install.sh picks the CUDA
  # wheels without the build-time nvidia-smi stub. On a DGX Spark / GB10 (the
  # GX10) it auto-detects /etc/dgx-release and uses the cu130 index. Two installs
  # are required: the API deps, then the local-provider extra that carries torch.
  ./install.sh install_conda create_conda_environment install_dependencies
  bash ./local_provider_conda_install.sh

  # Bake in our chat `conversations` router (the WSL sandbox patch is Linux-N/A).
  PY="$TLAB/envs/transformerlab/bin/python" bash /opt/rantai/apply-conversations.sh

  "$TLAB/miniforge3/bin/conda" clean -afy || true
  touch "$MARK"
  echo "[rantai-init] Install complete."
else
  # NOT first run: re-sync the vendored source from the image into the volume on
  # EVERY start, so a code patch shipped in a new image (e.g.
  # compute_providers/local.py) takes effect on a plain image-recreate WITHOUT
  # having to wipe the volume (which would also destroy the DB / API keys / models
  # and force the ~30-40 min reinstall). The image is the source of truth for
  # CODE; the volume keeps DATA. Only $TLAB/src is overwritten — the conda env
  # ($TLAB/envs), DB, workspace and models live elsewhere and are untouched.
  echo "[rantai-init] Re-syncing vendored source into the volume (code patches)."
  cp -a /opt/rantai/tl-src/. "$TLAB/src/"
  find "$TLAB/src" -name '*.sh' -exec sed -i 's/\r$//' {} +
  chmod +x "$TLAB/src/install.sh" "$TLAB/src/run.sh" 2>/dev/null || true
  cp /opt/rantai/serve/rantai_*.sh /root/ 2>/dev/null && chmod +x /root/rantai_*.sh 2>/dev/null || true
fi

# TL sandboxes each training job with bwrap (bubblewrap), which must create a new
# user namespace — and that needs a PRIVILEGED container. Many hosts (locked-down
# Portainer, the UGM GX10) forbid privileged, so bwrap fails at run time with
# "Creating new namespace failed: Operation not permitted" and every job FAILS.
# TL's own fallback: if it can't find `bwrap` on PATH it uses HOME-override
# isolation instead, which needs NO privileges. So unless RANTAI_SANDBOX=1 is set
# (which you'd pair with `privileged: true`), hide bwrap here so training just
# works on an unprivileged container. Runs every start (survives a redeploy).
if [ "${RANTAI_SANDBOX:-0}" != "1" ]; then
  # bwrap can live in TWO places and BOTH must be hidden:
  #   1. the system copy on PATH (/usr/bin/bwrap) — found by `command -v` here;
  #   2. a copy INSIDE TL's conda env ($TLAB/envs/*/bin/bwrap), installed as a
  #      pixi/conda dependency. It is NOT on PATH at this point, but run.sh
  #      activates that env for every training job, which puts its bin dir FIRST
  #      on PATH — so shutil.which("bwrap") finds THIS one and the job still
  #      fails with "Creating new namespace failed: Operation not permitted".
  #      Disabling only #1 is not enough; disable both.
  for _bw in "$(command -v bwrap 2>/dev/null || true)" "$TLAB"/envs/*/bin/bwrap; do
    if [ -n "$_bw" ] && [ -f "$_bw" ]; then
      echo "[rantai-init] RANTAI_SANDBOX!=1 → disabling bwrap ($_bw) so no privileged container is needed"
      mv "$_bw" "${_bw}.disabled" || true
    fi
  done
fi

# GPU-stats sidecar: serves nvidia-smi as JSON on :8341 so the UI's GPU widget
# works even though the frontend container has no GPU (see docker/backend/
# gpu-server.py). Best-effort background process — if it dies only the widget is
# affected, never training. Uses the system python3 (stdlib only).
python3 /opt/rantai/gpu-server.py >/tmp/rantai-gpu-server.log 2>&1 &

# Export sidecar: runs the merge -> GGUF -> `ollama create` pipeline scripts on
# request from the UI (POST :8342), so the frontend needs NO Docker socket /
# `docker exec`. Internal network only. Best-effort — if it dies only in-app
# export is affected, never training. See docker/backend/export-server.py.
python3 /opt/rantai/export-server.py >/tmp/rantai-export-server.log 2>&1 &

cd "$TLAB/src"
exec ./run.sh -p 8339 -h 0.0.0.0
