# RantAI decision server (docker/decision/server.py): serves decision models (System One typed
# decisions) with Unsloth's FastDecisionModel on PyTorch. vLLM and Ollama cannot serve these.
#
# Build context = the repository root (it copies trainers/unsloth-decision-train/decision_schema.py):
#   docker build -f docker/decision/Dockerfile -t rantai-decision-server:latest .
#
# The package recipe is the one validated on the GB10 (aarch64, CUDA 13) on 2026-10-22 and is the
# same as trainers/unsloth-decision-train/task.yaml: keep the two in step.
FROM python:3.11-bookworm

ENV PYTHONUNBUFFERED=1 UV_LINK_MODE=copy PIP_NO_CACHE_DIR=1
RUN pip install uv==0.13.5

# torch AND torchvision from the cu130 index (Qwen3.5's processor imports torchvision).
RUN uv pip install --system --index-url https://download.pytorch.org/whl/cu130 \
      --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match \
      "torch==2.10.0+cu130" "torchvision==0.25.0+cu130"

# unsloth 2026.10.8 is the first PyPI release pinned here that carries the decision code; bitsandbytes is required
# by unsloth_zoo even for 16-bit weights. gcc comes with this base image and is needed: Triton
# compiles small kernels at run time.
RUN uv pip install --system --index-strategy unsafe-best-match \
      "unsloth==2026.10.8" "unsloth_zoo==2026.10.8" \
      "transformers==5.17.0" "trl==1.15.0" "peft==0.21.2" "accelerate==1.15.0" "bitsandbytes==0.50.2" \
      "fastapi==0.162.0" "starlette==1.9.0" "uvicorn[standard]==0.54.0"

WORKDIR /app
COPY docker/decision/server.py trainers/unsloth-decision-train/decision_schema.py /app/

# The served set is remembered here, so a recreated container brings the same models back.
ENV UNSLOTH_DISABLE_STATISTICS=1 DECISION_STATE_FILE=/data/decision-models.json DECISION_PORT=8000
VOLUME /data
EXPOSE 8000
CMD ["python", "server.py"]
