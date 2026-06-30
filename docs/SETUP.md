# Setup — NQRust-LLMOps on Transformer Lab v0.40.0 (run from source)

This app runs against a **local** Transformer Lab v0.40.0 backend (from source)
plus **Ollama** for inference. No Docker, no cloud.

## Architecture (3 processes)

| Process | Where | Port | Role |
|---------|-------|------|------|
| Transformer Lab API (source) | WSL2 | `8339` | Orchestrator: train / eval / export / jobs / data / notes (via a local **compute provider** that runs jobs in a bubblewrap sandbox) |
| Ollama | WSL2 (host) | `11434` | Inference engine: chat + serving (v0.40.0 TL no longer serves models) |
| Next.js app | Windows | `3000` | UI + BFF; reaches both WSL backends via WSL2 localhost forwarding |

Why two backends: v0.40.0 **removed inference from the TL backend** and moved all
execution to compute providers. So serving is delegated to Ollama, while TL does
training/eval/data orchestration.

## Prerequisites (manual, one-time, heavy)

1. **WSL2 + Ubuntu** on Windows, with **NVIDIA CUDA-for-WSL** drivers.
2. **Transformer Lab from source** at `~/.transformerlab/src`, with the conda env
   `~/.transformerlab/envs/transformerlab` that has torch+CUDA, transformers, peft,
   fastapi, etc. (Follow TL's own source-install instructions.)
3. A **TL API key** and your **team id**. Create a key via the API once the
   backend is up:
   ```bash
   curl -X POST http://localhost:8339/auth/api-keys \
     -H "Authorization: Bearer <login-JWT>" -H "Content-Type: application/json" \
     -d '{"name":"nqr"}'
   ```
   (Get the login JWT from TL's `/auth/login`. The team id is on your account.)

## One-shot setup

From WSL, inside the repo:

```bash
TL_KEY=tl-xxxxxxxx TL_TEAM=<your-team-uuid> bash scripts/setup-v0.40.0.sh
```

This (idempotently):
1. **Patches** TL's sandbox for WSL — `scripts/setup/apply-sandbox-patch.sh`
   binds `/mnt/wsl` so bwrap can resolve `/etc/resolv.conf` (otherwise **every job
   FAILS** with `bwrap: Can't create file at /etc/resolv.conf`).
2. **Installs Ollama** userspace into `~/.local` (no sudo) — `scripts/setup/install-ollama.sh`.
3. Installs the serve-fine-tune scripts into `$HOME` (`nqr_export_gguf.sh`,
   `nqr_serve_finetune.sh` — used by the "Export to use" button).
4. Starts both backends.
5. Creates experiments `nqr-ft` / `nqr-eval`.
6. Raises the team quota to effectively unlimited (self-host, no cloud cost; the
   default `0` blocks all launches).
7. Pulls a default chat model (`qwen2.5:0.5b`).

Then set `.env.local` (see `.env.example` values printed by the script) and run
the app on Windows:

```bash
npm run dev    # http://localhost:3000
```

## Daily start (after a reboot)

```bash
# WSL — start both backends
bash scripts/start-all.sh
# Windows — start the app
npm run dev
```

`start-all.sh` starts Ollama (`:11434`) and the TL API (`:8339`) if they aren't
already up.

## How a fine-tune becomes chattable

1. **Fine-tune** → a compute-provider job trains a LoRA adapter (Unsloth, pulls
   the base model + dataset from Hugging Face by id).
2. **Export to use** → `scripts/serve/nqr_serve_finetune.sh` (via `wsl.exe`):
   merges the adapter into the fp16 base (peft) → converts to **GGUF**
   (llama.cpp) → `ollama create`. The model then appears in the chat picker.

## Access gate (optional)

Set `APP_PASSWORD` in `.env.local` to require a shared password for the whole
app (login screen + httpOnly cookie, enforced by `proxy.ts`). Also set
`AUTH_SECRET` (e.g. `openssl rand -hex 32`) so the session token isn't a plain
hash of the password — rotating it logs everyone out. Login is compared in
constant time and rate-limited (10 attempts / 5 min per IP). Leave `APP_PASSWORD`
empty to disable (frictionless local single-user dev). It's a simple team gate,
not per-user accounts.

## Host runner for export/merge (WSL today, Docker-ready)

The serve/eval-fine-tune pipeline (peft merge → GGUF → Ollama) runs in the
backend's environment, selected by `HOST_RUNNER` in `.env.local`:
`wsl` (default; `wsl.exe -d $WSL_DISTRO`), `docker` (`docker exec
$DOCKER_CONTAINER`), or `local`. Switching the backend to a container later is a
one-line env change — no code edits. Arguments are passed argv-isolated, so
job/model/tag values can't break out of the shell.

## Troubleshooting

- **Every job FAILS instantly** (`bwrap: Can't create file at /etc/resolv.conf`)
  → the sandbox patch isn't applied; run `scripts/setup/apply-sandbox-patch.sh`
  and restart the TL backend.
- **`Quota overused`** on launch → raise the team quota (step 6).
- **Chat says "Could not reach Ollama"** → Ollama isn't running; `bash scripts/start-all.sh`.
- **Picker / lists empty** → a fresh source workspace has no local TL models /
  datasets; that's expected. Training pulls base models + datasets from HF by id;
  the pickers offer recommended HF bases.
