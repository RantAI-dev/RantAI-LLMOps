# Vendored Transformer Lab backend

This folder is a **verbatim copy** of the Transformer Lab API/server, used as the
backend for nqllmops while we move fast. It is temporary scaffolding.

## Provenance
- Source: https://github.com/transformerlab/transformerlab-app (`/api`)
- Release: **v0.40.0** (api package version `0.27.0`)
- Vendored: 2026-06-15
- License: **AGPL-3.0** — see [`LICENSE`](./LICENSE). nqllmops is intended to be
  open source under an AGPL-compatible license; final license consolidation is
  deferred (see plan below).

## Plan / status
- **Now:** use as-is. Do not edit unless strictly necessary — a large refactor and
  a **migration to Rust** is planned, which will replace this backend.
- Because it will be rewritten, treat this like an upstream dependency: prefer
  configuring over modifying so re-syncing/replacing stays easy.

## How to run (Linux / WSL)
The server needs Python + `uv` (and, for the local compute provider, a conda env
with PyTorch/CUDA — heavy first-time install).

```bash
cd backend
./install.sh multiuser_setup   # build the uv/conda env + deps (first time, slow)
./run.sh                        # starts the API on http://localhost:8338
```

Default admin (created on first start): `admin@example.com` / `admin123` —
change it immediately.

## Notes for nqllmops integration (not wired yet)
- API base: `http://localhost:8338`; auth: JWT (login → bearer token); multi-tenant
  via `X-Team-Id` header.
- nqllmops will talk to this via a BFF (Next.js route handlers) — to be designed.
