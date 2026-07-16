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
fi

cd "$TLAB/src"
exec ./run.sh -p 8339 -h 0.0.0.0
