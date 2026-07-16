# syntax=docker/dockerfile:1
#
# Self-contained Transformer Lab v0.40.0 backend for RantAI-LLMOps.
#
# Unlike docker/Dockerfile (the thin dev container that bind-mounts a pre-built
# host ~/.transformerlab), this image BAKES everything in — TL source, the conda
# env (torch+CUDA), our conversations router patch, the serve/merge/export
# scripts, llama.cpp and the Ollama CLI — so it runs with no host setup:
#   docker compose up   (data persists on the named volume tl_data)
#
# Build from the REPO ROOT (needs backend/ + scripts/):
#   docker build -f docker/backend/Dockerfile -t rantai-llmops-backend .
#
# Multi-arch (amd64 + the GX10's arm64) via buildx. Heavy build (conda + torch +
# CUDA wheels ≈ several GB); arm64 must be built on/for the Grace-Blackwell host:
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -f docker/backend/Dockerfile -t ghcr.io/<org>/rantai-llmops-backend:0.40.0 --push .
#
# CAVEAT — code+data share one volume (upstream TL layout): /root/.transformerlab
# holds both the baked src+env AND the workspace/jobs/models. A fresh named volume
# is seeded from the image on first run; a later image won't overwrite a volume's
# old code. Acceptable for v1; revisit if TL upgrades need a code/data split.

ARG CUDA_TAG=12.8.1-devel-ubuntu22.04
FROM nvidia/cuda:${CUDA_TAG}

# buildx injects TARGETARCH (amd64 | arm64) — used to fetch the matching Ollama build.
ARG TARGETARCH

# install.sh probes `nvidia-smi` to choose CUDA vs CPU wheels. A build container has
# no GPU, so we stub nvidia-smi during the install layer (see below); this is only
# the GPU name that stub reports — any NVIDIA name works.
ARG BUILD_GPU_NAME="NVIDIA GeForce RTX 3060"

# For the GX10 / DGX Spark (GB10 Grace Blackwell), build with:
#   --build-arg TLAB_FORCE_CUDA13=1
# install.sh then uses the cu130 PyTorch index. It normally auto-detects DGX Spark
# via /etc/dgx-release, which a build container doesn't have — hence the override.
ARG TLAB_FORCE_CUDA13=""
ENV TLAB_FORCE_CUDA13=${TLAB_FORCE_CUDA13}

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/root \
    TLAB_DIR=/root/.transformerlab \
    PYTHONUNBUFFERED=1

SHELL ["/bin/bash", "--login", "-c"]

# OS deps: TL installer + build toolchain, the bwrap compute-provider sandbox,
# tini (PID 1 reaps job processes), and the serve-pipeline tools (git, zstd).
# Drop the NVIDIA CUDA apt repo first: we install nothing from it, and its mirror
# occasionally serves a mid-sync index that fails apt-get update.
RUN rm -f /etc/apt/sources.list.d/cuda*.list /etc/apt/sources.list.d/nvidia*.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      curl git ca-certificates \
      python3.11 python3-pip python-is-python3 g++ ninja-build \
      bubblewrap procps tini xz-utils zstd \
    && rm -rf /var/lib/apt/lists/*

# uv: the compute provider builds each job's venv with `uv venv`.
ENV UV_INSTALL_DIR=/usr/local/bin
RUN curl -LsSf https://astral.sh/uv/0.11.21/install.sh | env INSTALLER_NO_MODIFY_PATH=1 sh \
    && uv --version

# --- Vendored TL source (our exact v0.40.0), placed where install.sh expects it.
#     This replaces the upstream `download_transformer_lab` step. ---
COPY backend/ ${TLAB_DIR}/src/
WORKDIR ${TLAB_DIR}/src
# The repo is checked out on Windows, so the vendored shell scripts carry CRLF
# line endings and Linux rejects the shebang ("/bin/bash^M: bad interpreter",
# exit 126). Strip the CRs from every shell script before running any of them.
RUN find . -name '*.sh' -exec sed -i 's/\r$//' {} + \
    && chmod +x install.sh run.sh

# THE heavy step: miniforge (arch-aware) + conda env + all deps from the vendored
# source. Baked at build time (not at the entrypoint like upstream does) so the
# image is airgap-ready and starts fast. Explicit subcommands so
# `download_transformer_lab` never runs — our source is already vendored above.
#
# The nvidia-smi stub is load-bearing: install.sh decides CUDA-vs-CPU wheels by
# probing nvidia-smi, and a build container has no GPU — without the stub it bakes
# a CPU-only torch ("Installing with CPU support") and training would never touch
# the GPU. The stub is removed in the same layer so the REAL driver, injected by
# nvidia-container-toolkit at run time, is what the container actually uses.
#
# TWO installs are required, and this is easy to get wrong:
#   install.sh install_dependencies  → pyproject.toml = the API server deps only
#                                      (fastapi/uvicorn). It has NO extras and NO
#                                      torch — `.[nvidia]` there just warns
#                                      "does not have an extra named nvidia".
#   local_provider_conda_install.sh  → localprovider_pyproject.toml, whose
#                                      [nvidia] extra is where torch/torchvision/
#                                      torchaudio actually live. Without this the
#                                      image builds fine but has NO torch, so the
#                                      merge/export pipeline and local compute
#                                      provider cannot run. (Verified the hard way.)
RUN printf '#!/bin/sh\necho "%s"\n' "$BUILD_GPU_NAME" > /usr/local/bin/nvidia-smi \
    && chmod +x /usr/local/bin/nvidia-smi \
    && ./install.sh install_conda create_conda_environment install_dependencies \
    && bash ./local_provider_conda_install.sh \
    && rm -f /usr/local/bin/nvidia-smi \
    && /root/.transformerlab/miniforge3/bin/conda clean -afy \
    && rm -rf /root/.cache/uv /root/.cache/pip /root/.cache/conda /tmp/*

# --- Bake our source customisation: the chat `conversations` router (required by
#     the app). The WSL sandbox patch is intentionally SKIPPED — it fixes a WSL-only
#     /mnt/wsl resolv.conf quirk that does not exist on real Linux (the GX10). ---
COPY scripts/setup/conversations.py scripts/setup/apply-conversations.sh /tmp/nqr/
RUN sed -i 's/\r$//' /tmp/nqr/apply-conversations.sh \
    && PY="${TLAB_DIR}/envs/transformerlab/bin/python" bash /tmp/nqr/apply-conversations.sh \
    && rm -rf /tmp/nqr

# --- Serve / merge / export pipeline scripts (run in-container when the app uses
#     HOST_RUNNER=docker). They talk to the Ollama SERVICE via OLLAMA_HOST. ---
COPY scripts/serve/rantai_serve_finetune.sh \
     scripts/serve/rantai_merge.sh \
     scripts/serve/rantai_export_gguf.sh /root/
RUN sed -i 's/\r$//' /root/rantai_*.sh \
    && chmod +x /root/rantai_*.sh

# --- Ollama CLI for `ollama create` in the export pipeline (arch-matched). The
#     daemon runs as a separate service; this CLI targets it via OLLAMA_HOST. ---
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      arm64) OLLAMA_ARCH=arm64 ;; \
      *)     OLLAMA_ARCH=amd64 ;; \
    esac; \
    mkdir -p /root/.local; \
    curl -fL --retry 3 -o /tmp/ollama.tar.zst \
      "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-${OLLAMA_ARCH}.tar.zst"; \
    tar --use-compress-program=unzstd -xf /tmp/ollama.tar.zst -C /root/.local; \
    rm /tmp/ollama.tar.zst; \
    /root/.local/bin/ollama --version || true

ENV PATH=/root/.local/bin:${TLAB_DIR}/miniforge3/bin:$PATH

EXPOSE 8339
# Seeded from the image on first run; persists workspace/jobs/models thereafter.
VOLUME ["/root/.transformerlab"]

# tini as PID 1; run.sh auto-activates the baked conda env and launches uvicorn.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "--login", "-c", "cd /root/.transformerlab/src && exec ./run.sh -p 8339 -h 0.0.0.0"]
