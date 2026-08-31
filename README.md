<div align="center">

<img src="public/rantai-logo.png" alt="RantAI" width="120">

# LLMOps

**Fine-tune a model, evaluate it honestly, and serve it — from one control centre.**

[![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%C2%B7%20React%2019-000.svg)](#stack)
[![Training](https://img.shields.io/badge/training-Unsloth%20%C2%B7%20TRL%20LoRA-orange.svg)](trainers/)
[![Eval](https://img.shields.io/badge/eval-EleutherAI%20lm--eval--harness-blue.svg)](trainers/eleutherai-lm-evaluation-harness/)

</div>

---

An LLMOps control centre: a dashboard for running LoRA fine-tunes, scoring them on real
benchmarks, serving the results, and keeping track of datasets, models and compute — on
top of a (vendored) [Transformer Lab](https://github.com/transformerlab/transformerlab-app)
API server.

## What is actually live

The single source of truth is [`src/lib/feature-status.ts`](src/lib/feature-status.ts),
which marks every feature `live` / `simplified` / `mock` / `planned`. **Features marked
`mock` get a red dot and a banner in the UI**, so a demo screen is never mistaken for a
working one.

| Live | Mock (UI only, marked in-app) |
|---|---|
| **Fine-tune** — real LoRA training through TL's trainer plugin: submit, watch live, and the adapter appears in the model picker | RAG suite (documents, index, interact, evals) |
| **Evals** — real benchmark accuracy via the EleutherAI LM-Eval-Harness plugin | Model deployment orchestration and usage analytics |
| **Interact** — chat playground streaming from an OpenAI-compatible engine through the BFF | Realtime GPU metrics, per-job cost estimates |
| **Serve** — adapter attach/detach against a running vLLM | Dataset quality scan, external dataset connectors |

That table is enforced, not aspirational: the registry is what renders the badges.

## Quick start

```bash
npm install
cp .env.example .env.local     # defaults are fine to look around
npm run dev                    # http://localhost:3000
```

Real training and evaluation need the Transformer Lab backend running — see
[`docs/SETUP.md`](docs/SETUP.md).

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui**, `class-variance-authority`, `lucide-react`, `sonner`
- Backend (vendored, optional): **Transformer Lab** API — FastAPI, JWT auth, multi-tenant
- Serving: **vLLM** (multi-LoRA) and **Ollama**

## Architecture

### A server-side BFF

The browser never talks to the inference backend, Hugging Face or S3 directly. It calls
this app's own routes under [`src/app/api/**`](src/app/api), which proxy onward through
[`src/lib/inference.ts`](src/lib/inference.ts) and [`src/lib/s3.ts`](src/lib/s3.ts).

Every secret is therefore **server-only** — plain (non-`NEXT_PUBLIC_`) variables, never
inlined into the client bundle, read at request time on the server. That is a security
boundary, not a style preference.

### Feature-first layout

```txt
src/
  app/
    (app)/          dashboard · finetune · evals · serve · interact · models
                    datasets · compute · tasks · workflows · generations · hub · notes
    api/            the BFF: one route group per feature, plus adapters/
  modules/<feature>/  components · hooks · lib · services · context · types
  lib/
    feature-status.ts   the honesty registry
    inference.ts        transport to the orchestrator
  styles/design-tokens.css
```

Every domain reads through `modules/<feature>/services/*.ts`, which expose a sync seed
for instant render and an async fetch gated on the real-API flag. Components never
import mock data directly, so flipping a feature to the real backend touches one file.

## Training

[`trainers/`](trainers) holds the task scripts Transformer Lab clones and runs. They
live here because upstream's defaults were wrong for our hardware — a DGX Spark
(GB10, `sm_121`) — and **all three failed silently**.

| Upstream default | Why it hurt | What we do |
|---|---|---|
| `load_in_4bit=True`, hardcoded | 4-bit buys nothing against 128 GB unified memory, adds dequantisation to the hot path, and bitsandbytes' 4-bit kernels are reported to stall on `sm_121` | config knob, defaults **False**; BF16 when unquantised |
| `optim="adamw_8bit"` | routes the hot path through bitsandbytes for the same reason | `adamw_torch` |
| dataset load falls back to a 3-row placeholder | a wrong dataset id finished **green** having trained on nothing real | raise instead |

Three more deviations, all in service of the same rule:

- **Datasets may come from a local path, an http(s) URL or an S3/MinIO URI**, not only
  the Hugging Face Hub. A corpus that must stay on-premise cannot be required to travel
  through huggingface.co to be trainable.
- **A caught training error exits non-zero.** Upstream caught the exception, returned
  `{"status": "error"}` and still exited 0, so the job was marked COMPLETE — a green
  badge with no model, which is worse than a visible failure.
- **The model is pinned to one GPU** (`device_map={"": 0}`). Left on `auto`, accelerate
  offloads to CPU under the VRAM pressure a co-resident vLLM creates, producing a
  multi-device model that cannot be trained at all.

### Completion-only loss

A plain SFT run over a single `text` field computes loss across the **whole** sequence,
so the model is rewarded for reproducing the retrieved context and the question
scaffolding. At inference that shows up as regurgitated passages, echoed prompt
templates and run-on answers.

The trainer masks the prompt and trains on the assistant response only. The turn markers
are **derived from the model's own chat template** — a sentinel is pushed through
`apply_chat_template` and the result sliced — so it works for Apertus, Qwen and Llama
without hardcoding. If the marker is missing from a formatted sample, or the resulting
mask leaves 0% or 100% of tokens trainable, the run **fails loudly** rather than
training on the wrong thing. A wrong loss mask is the perfect silent failure: loss
drops, the curve looks normal, nothing is learned.

`eleutherai-lm-evaluation-harness/` is forked for the same reason. Upstream built
`--model_args` without naming a dtype, so weights loaded as fp16 while Apertus' xIELU
activation builds its parameters in bf16; the mix promotes to fp32 and the next `Linear`
rejects its own input. Every Apertus benchmark died there before scoring a sample.

### Keeping it diffable

`unsloth-llm-train/` stays structurally identical to upstream so changes can be diffed
and pulled forward; every deviation is listed in the module docstring at the top of
`train.py`. Add new ones to that list. The copy under
`backend/transformerlab/galleries/examples/` mirrors upstream and is **not** what runs —
treat it as the diff baseline.

> **Gotcha:** Transformer Lab clones the repo's **default branch**. A trainer edit only
> takes effect once it is merged to `main`; running a job from a feature branch still
> gets `main`'s copy.

## Serving

vLLM serves **several LoRA adapters on one base model**, with attach and detach at
runtime through `/api/adapters`. Because an adapter is tens of megabytes and the base
weights are shared, one GPU can serve many fine-tuned models at once — a large cost
difference from deploying a full model per tenant.

Two export bugs worth knowing about, both fixed here:

- **Double BOS.** When exporting to GGUF/Ollama the chat template can include a BOS
  token *and* the tokenizer prepends one, so every prompt gets two — shifting the
  distribution away from training conditions. The leading BOS is stripped when the
  tokenizer auto-prepends.
- **Serving format drift.** Ollama's `TEMPLATE` and stop tokens are derived from the
  merged tokenizer's chat template rather than written by hand. Otherwise the served
  model uses a different prompt format than the one it was trained on — a classic silent
  failure where the model is fine and the serving is wrong.

## Evaluation

Beyond raw benchmark accuracy, two things the harness does that are easy to skip:

- **The base model is evaluated alongside the fine-tuned one** in the retention view.
  That is a catastrophic-forgetting measurement — verifying that teaching a new task did
  not destroy general ability.
- **Grounding eval understands refusals.** A model that correctly declines to answer
  when the context does not support it is behaving as designed; a naive scorer counts
  that as wrong.

## Environment

Copy [`.env.example`](.env.example) to `.env.local`. All server-side; none are
`NEXT_PUBLIC_*`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `INFERENCE_BASE_URL` | `http://localhost:8339/v1` | Transformer Lab orchestrator. `TL_ROOT` is derived by stripping `/v1`. |
| `INFERENCE_API_KEY` | — | Bearer token for the orchestrator. |
| `INFERENCE_TEAM_ID` | — | Team/tenant id. |
| `HOST_RUNNER` | `wsl` | Where serve/merge tooling runs: `wsl`, `docker`, or `local`. |
| `WSL_DISTRO` / `DOCKER_CONTAINER` | `Ubuntu` / `transformerlab` | Target for the chosen runner. |
| `HF_TOKEN` | — | Lifts Hub rate limits, reaches gated repos. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama engine (default chat + serving). |
| `VLLM_BASE_URL` | `http://vllm:8000/v1` | vLLM endpoint. Unset to disable. |
| `VLLM_MODEL` | `aisingapore/Qwen-SEA-LION-v4-8B-VL` | Model vLLM serves (HF id or merged path). |
| `VLLM_GPU_UTIL` | `0.22` | GPU memory fraction — low because training is co-resident. |
| `VLLM_MAX_MODEL_LEN` | `16384` | Context window. |
| `APP_PASSWORD` | — | Access gate. **Required in production** (fails closed). |
| `AUTH_SECRET` | — | Per-deployment session secret. **Required in production.** |

Optional S3/MinIO for grounded eval sets: `S3_ENDPOINT_URL`, `AWS_REGION`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EVAL_SET_BUCKET`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) on `:3000` |
| `npm run build` / `start` | Production build and serve |
| `npm run lint` | ESLint — the tree is kept at 0 problems |
| `npm run test` | Vitest + Testing Library |

## The vendored backend

[`backend/`](backend/) is a verbatim copy of the Transformer Lab API server (FastAPI),
used as scaffolding while the product is built. It is **AGPL-3.0** (see
[`backend/LICENSE`](backend/LICENSE)) and is intended to be replaced by a Rust rewrite —
prefer configuring it over modifying it. See
[`backend/README.VENDORED.md`](backend/README.VENDORED.md).

```bash
cd backend
./install.sh multiuser_setup    # first time, slow
./run.sh                        # API on http://localhost:8338
```

## Demo mode (backend-free, for Vercel)

A fully mocked build for client showcases — every page is populated with realistic
fixture data (a training job mid-run, traces, evals, prompts, workflows,
deployments…) and the Playground streams a canned reply. **No Transformer Lab /
vLLM / Ollama backend is required**, so it deploys straight to Vercel.

Set three environment variables (Production **and** Preview), then deploy:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_DEMO_MODE` | `true` — turns demo mode on (inlined at build time, so changing it needs a redeploy) |
| `APP_PASSWORD` | the password clients enter at `/login` (avoid weak values) |
| `AUTH_SECRET` | any long random string, e.g. `openssl rand -hex 24` |

Deploy: import this repo in Vercel (Next.js is auto-detected) → add the three
vars → deploy → open the URL, log in, and browse the full UI. The build target
is the repo root; nothing else is needed. The mock lives under
[`src/lib/demo/`](src/lib/demo/) and is off unless `NEXT_PUBLIC_DEMO_MODE=true`,
so normal deployments are unaffected.
