# Run the Transformer Lab backend in Docker (local source)

Scaffold to run the **v0.40.0 TL backend in a container** while reusing your
**local source + conda env** via bind mount — same code, just isolated. The app
side is already Docker-ready: set `HOST_RUNNER=docker` and the serve/merge
pipeline runs via `docker exec` instead of `wsl.exe`.

> **Status: verified end-to-end on RTX 3060 / WSL2.** API + GPU passthrough +
> the nested `bwrap` sandbox + a real fine-tune job all run in the container.
> The one fix the bring-up surfaced: the image must ship `uv` (the compute
> provider builds each job's venv with it, and the host's `uv` lives outside the
> mounted dir) — already baked into the Dockerfile. Your hardware may still need
> a tweak or two; bring it up in the order below so you learn which piece breaks.

## Why bind-mount instead of baking the image?

You asked to "run the backend in Docker but with this local code." So the
container stays thin (CUDA driver + OS tools) and **mounts** `~/.transformerlab`
(source, conda env, miniforge, data) at the *same absolute path*. The conda env
already has torch+CUDA — torch bundles its own CUDA libs, so the container only
needs the NVIDIA **driver** (injected by nvidia-container-toolkit), not a full
CUDA toolkit. Fast to start, no env rebuild. (A fully-baked, portable image is a
later step — see bottom.)

## Prerequisites

- **Docker Desktop** with the WSL2 backend (or Docker Engine inside WSL).
- **nvidia-container-toolkit** so `--gpus` works in WSL. Quick check:
  `docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi`
  should print your GPU. If not, fix this first — nothing GPU-bound will work.
- Your existing local setup intact: `~/.transformerlab/src` + the conda env
  `~/.transformerlab/envs/transformerlab` (i.e. you've run the WSL setup once).

## Run it

```bash
# From WSL (NOT a Windows shell — ${HOME} must match where the conda env lives):
cd <repo>/docker
docker compose up --build
```

Then point the app at it in `.env.local` (Next stays on Windows):

```ini
INFERENCE_BASE_URL=http://localhost:8339/v1   # container publishes 8339
HOST_RUNNER=docker
DOCKER_CONTAINER=transformerlab               # matches container_name
```

`docker` must be on the Next process's PATH (Docker Desktop puts it there on
Windows) so the serve/merge `docker exec` works.

## Recommended bring-up order

1. **API only.** `docker compose up --build`, then from WSL:
   `curl localhost:8339/` → expect `200`. This proves the source + conda env run
   in the container. If it fails, it's a path/PATH/conda-activation issue, not GPU.
2. **GPU.** Confirm `docker exec transformerlab nvidia-smi` shows the GPU, then
   submit a tiny fine-tune from the app. If training can't see CUDA, the
   nvidia-container-toolkit / `gpus:` config is the culprit.
3. **bwrap sandbox.** Compute-provider jobs run inside `bwrap`. `privileged:
   true` is the sledgehammer to get them green; once working, try narrowing to
   the `cap_add: [SYS_ADMIN]` + `security_opt` block in the compose file.
4. **Serve → Ollama.** See below — the trickiest piece.

## Known hard parts (be honest with yourself here)

- **bwrap in Docker** = nested sandbox/user-namespaces. Needs `privileged` or
  `SYS_ADMIN` + unconfined seccomp/apparmor. This was already a pain point on
  WSL; the container adds a layer. **Verified working with `privileged: true`** —
  the provider logs `Sandbox backend: bwrap` and runs each job's setup inside it.
- **Serve → Ollama.** The export pipeline runs `ollama create` from a GGUF it
  just wrote *inside the container*. With Ollama on the host, the host daemon
  can't read the container's filesystem. Options:
  - keep `HOST_RUNNER=wsl`/`local` for the *serve* step (TL trains in Docker,
    serve runs on host against the same `~/.transformerlab`), **or**
  - run Ollama as a second container (uncomment in compose) and put the GGUF on
    a **shared volume** both containers mount, **or**
  - point the in-container `ollama` CLI at the host daemon
    (`OLLAMA_HOST=host.docker.internal:11434`) AND make the GGUF reachable.
  Start with the first option; it's the least work.
- **Path coupling.** The conda env's shebangs are absolute, so the host mount
  MUST land at the identical path. Run `docker compose` from WSL so `${HOME}`
  resolves to your WSL home, not `/root` or a Windows path.

## Later: a fully-baked, portable image

When you want an image that doesn't depend on a pre-built host env, replace the
bind mounts with a build that clones TL source + creates the conda env from its
lockfile, and bakes `scripts/serve/*` + llama.cpp in. That's a separate, larger
piece of work; this scaffold deliberately stops at "reuse my local setup."
