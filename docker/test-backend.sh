#!/bin/bash
# Verify, layer by layer, whether the Transformer Lab backend can run in Docker.
# Run from WSL (where ~/.transformerlab lives), inside the repo:
#
#   bash docker/test-backend.sh
#
# It checks prerequisites + GPU passthrough first (cheap), then — if you've run
# `docker compose up` — verifies the running container. It never starts the heavy
# build itself; it tells you when to.
set -uo pipefail

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1"; }
warn() { echo "  [....] $1"; }

CUDA_BASE="nvidia/cuda:12.8.0-base-ubuntu22.04"
CONTAINER="transformerlab"

echo "[0] Docker reachable from WSL"
if docker info >/dev/null 2>&1; then
  pass "docker daemon reachable from WSL"
else
  fail "docker daemon NOT reachable from WSL."
  echo "       Fix: Docker Desktop -> Settings -> Resources -> WSL Integration"
  echo "            -> enable your distro (Ubuntu) -> Apply & Restart."
  exit 1
fi

echo "[1] Local TL source + conda env (what gets bind-mounted)"
[ -f "$HOME/.transformerlab/src/run.sh" ] && pass "run.sh present" || { fail "missing ~/.transformerlab/src/run.sh"; exit 1; }
[ -x "$HOME/.transformerlab/envs/transformerlab/bin/python" ] && pass "conda env python present" || { fail "missing conda env"; exit 1; }

echo "[2] GPU passthrough (docker --gpus all). Pulls $CUDA_BASE on first run."
if docker run --rm --gpus all "$CUDA_BASE" nvidia-smi -L >/dev/null 2>&1; then
  pass "GPU visible to docker"
else
  fail "GPU not visible to docker — check nvidia-container-toolkit / Docker Desktop GPU support."
fi

echo "[3] TL container up on :8339?"
if curl -s --max-time 5 http://localhost:8339/ >/dev/null 2>&1; then
  pass "TL API answers on :8339"
else
  warn "TL not up yet. In another WSL terminal run:"
  echo "         cd \"$(dirname "$0")\" && docker compose up --build"
  echo "       then re-run this script to verify the container."
  exit 0
fi

echo "[4] Inside the container"
docker exec "$CONTAINER" nvidia-smi -L >/dev/null 2>&1 && pass "GPU visible INSIDE container" || fail "GPU not visible inside container (check 'gpus: all' in compose)"
docker exec "$CONTAINER" sh -c 'command -v bwrap' >/dev/null 2>&1 && pass "bwrap present (compute-provider sandbox)" || fail "bwrap missing in image"

echo ""
echo "Infra checks done. FINAL real test = drive it from the app:"
echo "  .env.local:"
echo "    INFERENCE_BASE_URL=http://localhost:8339/v1"
echo "    HOST_RUNNER=docker"
echo "    DOCKER_CONTAINER=$CONTAINER"
echo "  Then submit a tiny fine-tune from the UI and watch it reach COMPLETE."
echo "  (If training fails inside bwrap, start the container 'privileged' — see README.)"
