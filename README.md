# NQRust-LLMOps

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

All variables are `NEXT_PUBLIC_*` because the browser talks to the backend directly.
See [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_USE_REAL_API` | `false` | `false` = mock data (no backend). `true` = fetch from the real Transformer Lab API. |
| `NEXT_PUBLIC_TL_API_URL` | `http://localhost:8338` | Base URL of the Transformer Lab API (only used when the flag above is `true`). |

Switching from mock to real is a **single flag** — no component changes — because every
module fetches through a service seam (see [Architecture](#architecture)).

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
  modules/<feature>/        # auth, compute, datasets, experiments, llm-ops,
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

- Set the two `NEXT_PUBLIC_*` env vars in your host. Because they are build-time inlined,
  **rebuild** after changing them.
- In mock mode (`NEXT_PUBLIC_USE_REAL_API=false`) the app is fully static/standalone and
  needs no backend — handy for design review / demo deployments.
- For a real deployment, host the Transformer Lab backend separately and point the frontend
  at it; the backend is heavy (Python + CUDA for local training) and is not part of the
  Next.js build.

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
