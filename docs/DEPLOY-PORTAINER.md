# Deploying RantAI-LLMOps to Portainer

The whole product is three standalone containers, wired together only by env vars.
No host setup, no bind mounts — everything persists in Docker-managed named volumes.

```
  [frontend]  rantai-llmops-fe        :3000   ← the only port users touch
      │ env → http://transformerlab:8339 (backend), http://ollama:11434 (ollama)
      ▼
  [transformerlab]  rantai-llmops-backend  :8339   (Transformer Lab, self-contained)
      │ env → OLLAMA_HOST=http://ollama:11434
      ▼
  [ollama]  ollama/ollama           :11434

  volumes: tl_data · ui_data · ollama_data   (bind mounts: none)
```

The backend image is **self-contained**: on its FIRST start it installs the
conda + torch/CUDA environment into the `tl_data` volume (~30–40 min, one-time,
needs internet). After that it starts in seconds. On the GX10 (NVIDIA GB10 Grace
Blackwell, arm64) this installs natively and auto-selects the cu130 CUDA wheels.

---

## Prerequisites on the host

- **Portainer** managing the Docker host (single machine is fine).
- **NVIDIA Container Toolkit** so containers get the GPU (pre-installed on DGX OS).
- **Privileged containers allowed** — the backend's compute-provider sandbox
  (bwrap) needs it. Confirm with the Portainer admin / DTI.
- **~60 GB free disk** — the backend image is ~5 GB and its volume grows to
  ~15–20 GB after the first-run install.
- **Bind mounts: NOT required.** (Only the optional in-app GGUF export needs one —
  see the end.)

---

## 1. Get the images (CI)

Push to the repo, then publish a **GitHub Release** — the `ghcr.yml` workflow builds
and pushes both images multi-arch (amd64 + arm64) to GHCR:

- `ghcr.io/rantai-dev/rantai-llmops-fe`
- `ghcr.io/rantai-dev/rantai-llmops-backend`

Make the packages **public**, or run `docker login ghcr.io` on the host first.

## 2. Deploy the stack

Portainer → **Stacks → Add stack → Web editor**, paste
[`docker-compose.portainer.yml`](../docker-compose.portainer.yml) (or use the Git
repository option). Set these under **Environment variables**:

| Variable | Value |
|---|---|
| `TRANSFORMERLAB_JWT_SECRET` | `openssl rand -hex 32` |
| `TRANSFORMERLAB_REFRESH_SECRET` | `openssl rand -hex 32` (different!) |
| `APP_PASSWORD` | password for the web UI (e.g. `rantai-admin`) |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `HF_TOKEN` | (optional) HuggingFace token for gated models |
| `INFERENCE_API_KEY` | leave empty for now — filled in step 4 |

> **JWT secrets are mandatory.** Without them TL answers `/` but every login
> returns 500 (`jwt.encode` gets `None`).

Deploy. `ollama` and `frontend` come up in seconds; `transformerlab` will spend
**~30–40 min on first boot** installing itself. Watch its logs — it's ready when
you see `Uvicorn running on http://0.0.0.0:8339`.

## 3. Pull the default chat model

Portainer → `ollama` container → **Console** (`/bin/sh`):

```sh
ollama pull qwen2.5:0.5b
```

## 4. Bootstrap the backend (one-time)

A fresh Transformer Lab has an admin + personal team but **no API key**, which the
UI needs. Portainer → `transformerlab` container → **Console** (`/bin/bash`), then:

```bash
TL=http://localhost:8339
TOKEN=$(curl -s -X POST "$TL/auth/jwt/login" \
  -d "username=admin@example.com" -d "password=admin123" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
TEAM=$(curl -s "$TL/users/me/teams" -H "Authorization: Bearer $TOKEN" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
# Create the API key + the experiments the app expects, and raise the quota:
curl -s -X POST "$TL/auth/api-keys" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "{\"name\":\"rantai-llmops\",\"team_id\":\"$TEAM\"}"
H=(-H "Authorization: Bearer <paste api_key from above>" -H "X-Team-Id: $TEAM")
curl -s "${H[@]}" "$TL/experiment/create?name=rantai-ft"
curl -s "${H[@]}" "$TL/experiment/create?name=rantai-eval"
```

Copy the `api_key` value from step 4's response. (This is exactly what
[`scripts/bootstrap-tl-auth.sh`](../scripts/bootstrap-tl-auth.sh) automates.)

## 5. Wire the key into the UI

Back in the stack's **Environment variables**, set `INFERENCE_API_KEY` to the key
from step 4 and **redeploy** (Portainer re-creates the frontend). Optionally set
`INFERENCE_TEAM_ID` to the team id — if left empty, TL falls back to the admin's
personal team, which is what a fresh install wants.

## 6. Done

Open `http://<host>:3000`, log in with `APP_PASSWORD`. Fine-tuning, chat, the live
monitor, GPU metrics, and evals all work.

---

## Notes

- **ARM64 / GX10:** the backend image is built for arm64 too; the first-run install
  runs natively there and picks cu130 automatically (it detects `/etc/dgx-release`).
  This path is only fully exercised on the GX10 itself.
- **Optional in-app GGUF export:** the merge → GGUF → Ollama pipeline needs the UI
  to reach the Docker socket, which is a bind mount (off by default). To enable it,
  uncomment the `docker.sock` line in the frontend service and allow bind mounts in
  Portainer. Everything else works without it.
- **Persistence:** all data lives in `tl_data` (models/jobs/DB), `ui_data`
  (app data), `ollama_data` (models). They survive redeploys; only `-v` / volume
  removal deletes them.
- **Postgres (optional):** TL uses SQLite by default (fine for one machine). To use
  Postgres instead, add a `postgres` service and set `DATABASE_URL` on the backend.
