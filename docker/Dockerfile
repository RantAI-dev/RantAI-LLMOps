# syntax=docker/dockerfile:1
#
# Transformer Lab v0.40.0 backend — containerised, running your LOCAL source +
# conda env via bind mount (see docker/README.md).
#
# This image is intentionally THIN. torch/CUDA live in the *mounted* conda env
# (which bundles its own CUDA libraries), so the container only needs:
#   - the NVIDIA driver, injected at run time by nvidia-container-toolkit, and
#   - the OS-level tools TL shells out to.
#
# Match the CUDA tag to your host — run `nvidia-smi` and use a base image whose
# CUDA version is <= the "CUDA Version" shown there. (cu128 env → 12.8 base.)
FROM nvidia/cuda:12.8.0-base-ubuntu22.04

# - bubblewrap : TL's compute-provider sandbox (the bwrap the WSL setup patches)
# - git        : the local compute provider clones GitHub-hosted trainer/eval tasks
# - curl + ca-certificates : health checks + HF / uv downloads
# - procps     : TL inspects child job processes
# - tini       : clean PID 1 so spawned job processes are reaped (no zombies)
RUN apt-get update && apt-get install -y --no-install-recommends \
      bubblewrap git curl ca-certificates procps tini bash \
    && rm -rf /var/lib/apt/lists/*

# uv: the compute provider builds each job's venv with `uv venv`. The host has it
# at ~/.local/bin — OUTSIDE the mounted ~/.transformerlab — so the container needs
# its own copy on PATH. Pinned to match the host (uv 0.11.21).
ENV UV_INSTALL_DIR=/usr/local/bin
RUN curl -LsSf https://astral.sh/uv/0.11.21/install.sh | env INSTALLER_NO_MODIFY_PATH=1 sh \
    && uv --version

# Everything real (source, conda env, miniforge, workspace/jobs data) is
# bind-mounted under $HOME/.transformerlab at the SAME absolute path as the host
# (see compose), so the conda env's baked-in shebangs keep resolving. Nothing
# heavy is COPYed into the image.
WORKDIR /workspace

# run.sh launches uvicorn on the port passed via -p.
EXPOSE 8339

# tini as PID 1; the real launch command lives in compose so the conda
# activation + run.sh invocation stay visible and editable.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "-lc", "echo 'Set the launch command in docker-compose.yml' && sleep infinity"]
