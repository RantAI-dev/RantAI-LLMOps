# LLMOps

An LLMOps control center — a Next.js dashboard for running and tracking experiments,
tasks/runs, datasets, RAG knowledge bases, a model registry, and compute providers —
on top of a (vendored) [Transformer Lab](https://github.com/transformerlab/transformerlab-app)
API server.

> **Status:** the frontend is feature-complete as a UI and runs on in-memory mock data
> by default. A real backend (the vendored Transformer Lab API under [`backend/`](backend/))
> can be switched on with one env flag. The backend is treated as temporary scaffolding —
> a rewrite to **Rust** is planned (hence the "NQRust" name).

---

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (base-ui / base-nova primitives)
- **class-variance-authority** for component variants, **lucide-react** icons, **sonner** toasts
- Backend (vendored, optional): **Transformer Lab** API — FastAPI, JWT auth, multi-tenant

---

## Quick start

```bash
# 1. install dependencies
npm install

# 2. (optional) configure environment
cp .env.example .env.local      # defaults are fine for mock mode

# 3. run the dev server
npm run dev                     # http://localhost:3000
```

By default the entire UI runs on **mock data** — no backend, database, or credentials
required. Any login credentials are accepted in mock mode.

---

## Environment variables

The app is a **server-side BFF (Backend-for-Frontend)**: the browser never talks to the
inference backend, Hugging Face, or S3 directly. It calls this app's own API routes under
[`src/app/api/**`](src/app/api), which proxy to the backend through
[`src/lib/inference.ts`](src/lib/inference.ts) (and [`src/lib/s3.ts`](src/lib/s3.ts)). All
secrets therefore stay **server-only** — they are plain (non-`NEXT_PUBLIC_`) env vars, are
never inlined into the client bundle, and are read at request time on the server.

Copy [`.env.example`](.env.example) to `.env.local`; Next.js loads it automatically. Real,
server-side variables (none are `NEXT_PUBLIC_*`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `INFERENCE_BASE_URL` | `http://localhost:8339/v1` | Transformer Lab orchestrator (train/eval/data/jobs). `TL_ROOT` is derived by stripping the trailing `/v1`. |
| `INFERENCE_API_KEY` | — | Bearer token for the TL orchestrator. |
| `INFERENCE_TEAM_ID` | — | TL team/tenant id. |
| `HOST_RUNNER` | `wsl` | Where the serve/merge tooling runs: `wsl`, `docker`, or `local`. |
| `WSL_DISTRO` | `Ubuntu` | WSL distro name (when `HOST_RUNNER=wsl`). |
| `DOCKER_CONTAINER` | `transformerlab` | TL backend container name (when `HOST_RUNNER=docker`). |
| `HF_TOKEN` | — | Optional Hugging Face token (lifts Hub rate limits, reaches gated repos). |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama engine (default chat + serving). |
| `INFERENCE_MODEL` | `qwen2.5:0.5b` | Default Ollama chat model (overridable per request). |
| `VLLM_BASE_URL` | `http://vllm:8000/v1` | vLLM engine endpoint. Unset to disable vLLM. |
| `VLLM_API_KEY` | — | Only if vLLM was launched with `--api-key`. |
| `VLLM_MODEL` | `aisingapore/Qwen-SEA-LION-v4-8B-VL` | Model the vLLM service serves (HF id or local merged path). |
| `VLLM_SERVED_NAME` | `qwen-sea-lion-v4-8b` | Served-model name advertised by vLLM. |
| `VLLM_GPU_UTIL` | `0.22` | Fraction of GPU memory vLLM reserves. |
| `VLLM_MAX_MODEL_LEN` | `16384` | vLLM context window (input+output tokens). |
| `INFERENCE_STREAM` | `true` | Enable SSE streaming for chat responses. |
| `APP_PASSWORD` | — | Shared-password access gate. **Required in production** (app fails closed / 503 if empty or a known-weak value). |
| `AUTH_SECRET` | — | Per-deployment secret folded into the session token. **Required in production.** Generate with `openssl rand -hex 32`. |

Optional S3/MinIO variables (read by [`src/lib/s3.ts`](src/lib/s3.ts) for grounded eval sets,
trainable datasets, and the PDF corpus): `S3_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `EVAL_SET_BUCKET`, `S3_ALLOWED_BUCKETS`. These are likewise server-only
credentials and never reach the browser. `S3_ALLOWED_BUCKETS` is an allowlist — a bucket must be
listed there before any route may read or write it.

---

## Corpus pre-processing (PDF → citation-headed chunks)

**Dataset → “From PDF”** turns a school-book PDF into chunks ready to load into a RAG knowledge
base. It implements Fase 1 of `rencana-teknis-asisten-belajar-rag-sft.pdf`:

| Step | What happens |
| --- | --- |
| Triage | Pages with no usable text layer are counted and reported. A scanned book is flagged for the OCR/VL path rather than turned into empty chunks. |
| Clean | Repeated running headers/footers and page numbers are removed; cover, colophon and daftar isi are dropped. |
| Structure | Chapters come from the PDF's bookmarks when it has them, otherwise from heading typography, otherwise from the `Bab N \| Title` running header. Which one was used is shown in the UI. |
| Chunk | ~500-token chunks (configurable) with 15% overlap, cut at paragraph and sub-heading boundaries. |
| Cite | Every chunk is prefixed with `[Buku IPA Kelas 3, Bab 2: Wujud Benda]`, so the source travels *inside* the text and survives retrieval even when the store drops metadata. |

Analyze is a dry run — nothing is written until you press save. Saving writes four objects per
book under the chosen bucket:

```txt
raw/<jenjang>/kelas-<n>/<mapel>/<id>.pdf     the original, untouched
processed/…/<id>.md                          cleaned Markdown
chunks/…/<id>.jsonl                          ingest-ready chunks
catalog/…/<id>.json                          metadata, checksum, triage, chapter map
```

Implementation: [`src/lib/pdf-corpus.ts`](src/lib/pdf-corpus.ts) holds the pipeline as pure
functions (no PDF library, fully unit-tested); [`src/lib/pdf-extract.ts`](src/lib/pdf-extract.ts)
is the only file that imports `pdfjs-dist`; the route is
[`/api/corpus/process`](src/app/api/corpus/process/route.ts).

> Uploads are capped at 64 MB. The cap lives in
> [`src/lib/upload-limits.ts`](src/lib/upload-limits.ts) because it must match
> `experimental.proxyClientMaxBodySize` in [`next.config.ts`](next.config.ts) — over that limit
> Next silently *truncates* a proxied body instead of rejecting it.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (Turbopack) on `:3000` |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (`eslint-config-next`) — the tree is kept at **0 problems** |

---

## Architecture

### Frontend (this repo's own code)

Feature-first layout — one folder per feature under `src/modules/`, each self-contained:

```txt
src/
  app/                      # Next.js App Router
    (app)/                  # authenticated route group (providers mounted in layout.tsx)
      dashboard/ experiments/ tasks/ interact/ evals/ documents/
      notes/ models/ datasets/ tasks-gallery/ compute/
  components/
    layout/                 # app shell (sidebar + header)
    ui/                     # shared shadcn primitives + cross-feature components
                            #   (StatusBadge, SummaryCardGrid, FilterBar, …)
  lib/
    api/                    # transport: config, client (fetch wrapper), session, auth
    feature-status.ts       # which features are live / mock — the honesty registry
    utils.ts                # cn()
  modules/<feature>/        # auth, compute, corpus, datasets, experiments, llm-ops,
                            # model-registry, tasks, tasks-gallery
    components/ hooks/ lib/ data/ constants/ services/ context/ types.ts index.ts
  styles/design-tokens.css  # ~60 semantic color tokens + the type scale
```

Key patterns:

- **Service seam (mock → real in one place).** Every domain reads through
  `modules/<feature>/services/*.ts`, which expose `seedX()` (sync seed for instant render)
  and `fetchX()` (async, gated on `NEXT_PUBLIC_USE_REAL_API`). Components and providers
  never import mock data directly, so flipping to the real backend touches only the service
  files.
- **Context providers** (`llm-ops`, `datasets`, `model-registry`, `auth`) hold the in-memory
  state. Their `value` is memoized and large concerns are split into hooks
  (e.g. `use-huggingface-*-import`, `use-rag-knowledge-bases`) and pure modules
  (`tasks/lib/run-engine.ts`) so the providers stay focused.
- **Feature-honesty registry** (`src/lib/feature-status.ts`) marks each feature `live` /
  `simplified` / `mock` / `planned`. Mock features get a red dot/banner in the UI so a demo
  screen is never mistaken for a working one. Today's `mock` set: the RAG suite, model
  serving/deploy & usage analytics, realtime GPU metrics, per-job cost, dataset quality scan.
- **Design tokens.** Colors come from `src/styles/design-tokens.css`; the brand color is
  `--primary` (`#ff5001`). The type scale uses Tailwind's `text-xs … text-3xl` utilities.

### Backend (vendored Transformer Lab API — optional)

[`backend/`](backend/) is a verbatim copy of the Transformer Lab API server (FastAPI),
used as scaffolding while the product is built. It is **AGPL-3.0** (see
[`backend/LICENSE`](backend/LICENSE)) and is intended to be replaced by a Rust rewrite —
prefer configuring over modifying it. See [`backend/README.VENDORED.md`](backend/README.VENDORED.md).

Run it (Linux / WSL — needs Python + `uv`, and a conda env for the local GPU provider):

```bash
cd backend
./install.sh multiuser_setup    # first time, slow
./run.sh                        # API on http://localhost:8338
```

A default admin (`admin@example.com` / `admin123`) is created on first start — change it
immediately. Auth is JWT (`POST /auth/jwt/login`); multi-tenancy is via the `X-Team-Id`
header. To use it from the frontend, set `NEXT_PUBLIC_USE_REAL_API=true`, point
`NEXT_PUBLIC_TL_API_URL` at the server, and make sure its CORS allows `http://localhost:3000`.

---

## Build & deploy

```bash
npm run build      # produces an optimized production build
npm run start      # serves it on :3000
```

The frontend builds to a standard Next.js App Router output and deploys to any Next.js host
(e.g. **Vercel**, or a Node server via `npm run build && npm run start`). It needs **Node 20+**.

Deployment notes:

- Set the server-side env vars (see [Environment variables](#environment-variables)) in your
  host. They are read at request time on the server — no rebuild is needed to change them,
  and none are inlined into the client bundle.
- In production (`NODE_ENV=production`) `APP_PASSWORD` and `AUTH_SECRET` are **required** — the
  app fails closed (503) without strong values.
- For a real deployment, host the Transformer Lab backend separately and point the app's BFF
  at it via `INFERENCE_BASE_URL`; the backend is heavy (Python + CUDA for local training) and
  is not part of the Next.js build.

---

## Conventions

- **New feature?** Add `src/modules/<feature>/` following the existing layout and export a
  thin public surface from its `index.ts`. Read data through a `services/` file.
- **Shared UI** (badges, summary grids, filter bars) lives in `src/components/ui/` — reuse
  it instead of re-implementing per module.
- **Knowledge log.** Every meaningful change is appended to
  [`AI_KNOWLEDGE_LOG.md`](AI_KNOWLEDGE_LOG.md) (append-only, local UTC+7 timestamp) per
  [`AGENTS.md`](AGENTS.md).
- Keep `npm run build` and `npm run lint` green before committing.

---

## License

The frontend is intended to be open source under an AGPL-compatible license. The vendored
backend is AGPL-3.0; final license consolidation is tracked alongside the planned Rust
rewrite.
