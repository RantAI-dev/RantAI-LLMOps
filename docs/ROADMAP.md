# Roadmap & Status — NQRust-LLMOps

**Update:** 29 Juni 2026 · **Status:** **Migrasi v0.40.0 (run-from-source) SELESAI** — loop LLMOps penuh live dari browser

> Produk LLMOps **self-host untuk tim**, berjalan **lokal** (tanpa cloud). Training =
> Transformer Lab (v0.40.0, dari source) + Unsloth; inference via **Ollama**
> (OpenAI-compatible). Engine training dan inference kini **terpisah** (lihat
> arsitektur).

---

## ⚙️ Arsitektur sekarang (BUKAN Docker lagi)

Transformer Lab v0.40.0 **mencabut inference dari backend** dan memindah semua
eksekusi (train/eval/export) ke **compute-provider (SkyPilot-style)**. Jadi
arsitekturnya 3 proses lokal:

| Proses | Port | Peran |
|--------|------|-------|
| **TL source** (WSL) | `:8339` | Orchestrator: train / eval / export / jobs / data / notes (via compute-provider lokal, di sandbox bwrap) |
| **Ollama** (WSL host) | `:11434` | Engine inference: chat + serving (TL tak lagi serve model) |
| **Next BFF** (Windows) | `:3000` | Jembatan UI ↔ kedua backend (Windows ↔ WSL via localhost forwarding) |

Docker v0.30.3 **sudah ditinggalkan**. Semua fitur memakai backend source `:8339`
+ Ollama `:11434`.

---

## ✅ Status fitur — hasil AUDIT NYATA (29 Juni, lawan source backend)

Diverifikasi end-to-end via BFF `:3000` → source `:8339` + Ollama `:11434`.

### Loop inti — JALAN, data nyata
- [x] **Chat / Interact** — Ollama `/v1`, streaming · *picker model Ollama (pulled + recommended)*
- [x] **Fine-tune (LoRA)** — submit via compute-provider (trainer Unsloth dari HF) → job COMPLETE di GPU; history + log nyata
- [x] **Eval (benchmark)** — lm-eval harness via provider → COMPLETE; **skor** (`acc`) kebaca + Compare
- [x] **Export + Serve fine-tune** — tombol "Export to use": adapter → merge → **GGUF** → import Ollama → **chat dgn model latihan sendiri**
- [x] **Tasks** — monitor job (REMOTE) + status + logs
- [x] **Experiments** — list (alpha / nqr-ft / nqr-eval)
- [x] **Deployments / Serve** — model sbg API (Ollama `/v1`) + test endpoint + lifecycle (load=pull / stop=unload)
- [x] **Generations** — banding output base vs fine-tuned (per-model, lewat Ollama) · *fix: model di-name eksplisit + fallback servable*
- [x] **Workflows** — pipeline 1-klik train→eval→export · *fix v0.40.0: train→jobId, eval BASE (referensi; adapter tak bisa di-eval harness), export→Ollama*
- [x] **Sweep** — latih grid hyperparameter; tiap combo jadi adaptor · *reframe v0.40.0: bandingkan via Export+chat (auto-eval fine-tune tak feasible di harness)*
- [x] **Notes** — **server-side** (`/experiment/{id}/notes`, tersimpan di TL, team-visible)
- [x] **Model picker / Registry** — model Ollama (servable) + rekomendasi; delete (Ollama rm)
- [x] **Dataset** — list / preview / **create** (verified: `/data/new`+`fileupload` jalan di source)
- [x] **Recipes** — **repoint ke task gallery v0.40.0** (25 template: Unsloth/TRL/lm-eval/dll); "use" = buat experiment
- [x] **Dashboard** — agregat dari catalog + datasets + tasks

- [x] **Compute** — wired ke `/compute_provider/providers/` nyata (provider "Local")
- [x] **Auth (gate password ringan)** — `APP_PASSWORD` opsional → login + cookie + middleware proteksi seluruh app (bukan multi-user)
- [x] **Setup reproducible** — `scripts/setup-v0.40.0.sh` + `start-all.sh` + `docs/SETUP.md`

### ⚠️ Kosong sampai diisi (bukan bug)
- [ ] **Model Registry "downloaded" (TL)** kosong — v0.40.0 tak "download model ke workspace"; base model **by HF id** (trainer pull runtime). Picker fine-tune/eval menyodorkan base HF rekomendasi.

### ❌ Tidak tersedia di build TL ini
- [ ] **Conversations history server-side** — endpoint `/conversations` **tidak ada** di build TL source ini (sama kasus Recipes lama). Chat history tetap localStorage (jalan baik).
- [ ] **Multi-user accounts / RBAC** — di-skip; pakai gate password bersama. TL `fastapi-users` ada bila mau full nanti.

### Belum (keputusan, bukan blocker)
- [ ] **Auth / teams / RBAC** — di-skip (TL punya `fastapi-users`, feasible kapan saja)
- [ ] **Compute** — masih placeholder/mock (belum ada backend nyata)
- [ ] **Plugin management** — niche, low value

**Di luar scope (sengaja):** RAG/Documents, Diffusion (gambar), Audio (TTS), cloud.

---

## 🔧 Catatan teknis migrasi v0.40.0

**Perubahan paradigma vs v0.30.3:**
- Eksekusi train/eval/export = **compute-provider launch** (bukan plugin+queue). Job bertipe `REMOTE`.
- Inference **dicabut dari backend** → Ollama di host.
- Base model & dataset training **di-pull dari HF by id** saat runtime (bukan dari workspace lokal).
- Skor eval pindah dari `job_data.score` → **artifacts** (`get_eval_results`).

**Setup environment (DI LUAR repo — perlu ada di mesin / mesin lain):**
1. **Patch `sandbox.py`** di source TL — fix bwrap WSL (`/etc/resolv.conf` symlink). Tanpa ini semua job FAILED.
2. **Ollama** userspace di WSL (`~/.local/bin/ollama`) + `~/start_ollama.sh`.
3. **Scripts serve-fine-tune:** `~/nqr_export_gguf.sh` + `~/nqr_serve_finetune.sh` (merge→GGUF→Ollama; clone llama.cpp sekali).
4. **Quota team** TL dinaikkan (default 0 → block); experiment `nqr-ft` / `nqr-eval`.
5. **`.env.local`:** `INFERENCE_BASE_URL=:8339/v1` (orchestrator), `OLLAMA_BASE_URL=:11434` (inference), `INFERENCE_MODEL`.

➡️ Layak dibikin `scripts/setup-v0.40.0.sh` + dokumen biar reproducible 1-klik. Detail lengkap di `AI_KNOWLEDGE_LOG.md`.

---

## 🚀 Next Steps (urut nilai)
1. **Script setup + dokumen** — bungkus 5 langkah environment di atas jadi reproducible (penting buat mesin lain / tim).
2. **Datasets** — wire create/registrasi dataset di v0.40.0 (atau perjelas bahwa training pakai HF id).
3. **Recipes** — reimplementasi di atas task gallery v0.40.0 (atau ganti halaman jadi "Task Gallery").
4. **Conversations server-side** — wire ke endpoint TL (sekarang ada di source).
5. **Auth / teams** — kalau mau benar-benar team-ready.

## Keputusan Tercatat
- Target: **produk self-host untuk tim** (privat, bukan SaaS) · **lokal selamanya**
- Backend: **run from source v0.40.0** (Docker ditinggalkan); rename/rewrite (Rust) ditunda
- Inference: **Ollama** (selaras goal "serve via ollama/vllm/llamacpp")
- Lisensi: ditangguhkan (pemakaian internal) · **Auth:** di-skip sekarang
