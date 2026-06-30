# Roadmap & Status — NQRust-LLMOps

**Update:** 30 Juni 2026 · **Status:** **Fase 1 + Fase 2 SELESAI** + **pengerasan kualitas/keamanan (senior code review)** — loop LLMOps penuh live dari browser, terverifikasi end-to-end; codebase di-review & di-hardening.

> Produk LLMOps **self-host untuk tim**, berjalan **lokal** (tanpa cloud). Training =
> Transformer Lab (v0.40.0, dari source) + Unsloth; inference via **Ollama**
> (OpenAI-compatible). Engine training dan inference kini **terpisah**.

---

## 🎯 Vonis Fase 1 & Fase 2

- **Fase 1 (wire fitur LLMOps ke UI): BERES.** Semua fitur loop produk jalan dengan data nyata (lihat tabel). Pengecualian jujur: multi-user auth (sengaja di-skip) + Plugin management (niche/usang) — tak ada yang menghalangi produk.
- **Fase 2 (run backend dari source, lepas Docker): BERES.** Backend jalan dari `~/.transformerlab/src` (v0.40.0) di `:8339`, patch WSL diterapkan, app di-repoint, loop chat→fine-tune→eval→serve diverifikasi setara/lebih dari Docker. Bonus Fase 2 (Notes server-side) ✅.

---

## 🛡️ Pengerasan kualitas & keamanan — senior code review (30 Juni 2026)

Review menyeluruh + perbaikan. **tsc 0 error · eslint 0 warning · 90/90 test.** Fitur tak berubah — fokus correctness, keamanan, dan kejujuran data. Detail per-perubahan di `AI_KNOWLEDGE_LOG.md`.

**Keamanan**
- Jembatan WSL (export/merge) **anti-injection**: argv-form (`runHostScript`, template tetap + `"$@"`, nilai user tak pernah masuk string perintah) + validasi per-field (`assertJobId/ModelId/Tag`) saat submit & export. **Sekaligus Docker-ready** → tinggal `HOST_RUNNER=docker`.
- **Auth diperketat**: banding token **constant-time**, token = SHA-256(`AUTH_SECRET` + password) (bukan password polos; rotasi secret = revoke semua sesi), **rate-limit login** 10×/5 menit per IP.
- **HF token diredaksi** dari pesan error upstream sebelum sampai ke browser.

**Correctness & kejujuran data**
- **Optimistic UI jujur** (`runOptimistic`): aksi yang gagal di server (stop/hapus task, buat/hapus experiment, simpan/hapus chat) kini **rollback + toast**, bukan diam-diam "berhasil" palsu.
- **Simulasi progress palsu (`Math.random`) dihapus** — progress task murni dari job TL nyata, **live via polling** (silent tiap 5s saat ada task aktif, berhenti saat idle). `fetchTasks` jujur saat kosong (0 job → tampil kosong, bukan task demo).
- Eval list tahan gagal-parsial (satu skor error tak blank-kan seluruh tabel); poll eval berhenti untuk job gagal; tag fine-tune **anti-tabrakan** (sertakan job id).

**Robustness**
- Semua fetch ke TL via **`tlFetch`** (timeout 30s — backend hang tak gantung worker; unwrap seragam, konstanta experiment terpusat).
- Hook lifecycle: race `useResourceFetch` (last-writer) ditutup; `use-sweep`/`use-evals` **guard unmount** (stop polling + tak setState pasca-unmount).
- **Error logging** (`logServerError`): kegagalan read/list yang dulu ditelan diam-diam kini kelihatan di server log (outage ≠ "data kosong").
- **+25 unit test** untuk helper baru (validate, redact, auth, optimistic, rate-limit, unwrapList, fineTuneTag).

---

## ⚙️ Arsitektur (BUKAN Docker lagi)

v0.40.0 **mencabut inference dari backend** + memindah semua eksekusi (train/eval/export) ke **compute-provider**. Tiga proses lokal:

| Proses | Port | Peran |
|--------|------|-------|
| **TL source** (WSL) | `:8339` | Orchestrator: train / eval / export / jobs / data / notes (compute-provider lokal, sandbox bwrap) |
| **Ollama** (WSL) | `:11434` | Engine inference: chat + serving |
| **Next BFF** (Windows) | `:3000` | Jembatan UI ↔ kedua backend (WSL↔Windows localhost forwarding) |

---

## ✅ Status fitur — AUDIT NYATA (verified via BFF `:3000` → `:8339` + Ollama)

### Loop inti — JALAN, data nyata, terverifikasi end-to-end
- [x] **Chat / Interact** — Ollama `/v1` streaming; picker model Ollama (pulled + recommended)
- [x] **Fine-tune (LoRA)** — submit via compute-provider (Unsloth, base+dataset dari HF) → job COMPLETE di GPU; history + log nyata
- [x] **Eval (benchmark)** — lm-eval harness via provider; **bisa eval base HF *atau* fine-tune sendiri** (merge adapter→base lokal → `model_path`). Skor `acc` kebaca + Compare. *(verified: fine-tune nqr-real-adaptor acc=0.613)*
- [x] **Export + Serve fine-tune** — tombol "Export to use": adapter → merge → **GGUF** → import Ollama → **chat dgn model latihan sendiri**
- [x] **Tasks** — monitor job (REMOTE) + status + **progress live** (polling silent tiap 5s saat ada task aktif, bukan animasi palsu) + **live logs** (provider console di-tail tiap 3s saat RUNNING, badge "Live")
- [x] **Experiments** — list
- [x] **Deployments / Serve** — model sbg API (Ollama `/v1`) + test endpoint + lifecycle
- [x] **Generations** — banding output base vs fine-tuned (per-model, lewat Ollama)
- [x] **Workflows** — pipeline 1-klik train→eval(fine-tune)→export, terverifikasi e2e
- [x] **Sweep** — latih grid hyperparameter; tiap combo jadi adaptor → bandingkan via Export+chat
- [x] **Notes** — **server-side** (`/experiment/{id}/notes`, tersimpan di TL, team-visible)
- [x] **Chat history (Conversations)** — **server-side**: kita **tambah router `conversations` ke source TL** (mirror `notes.py`); riwayat chat tersimpan di TL, team-visible (bukan localStorage lagi)
- [x] **Model picker / Registry** — model Ollama (servable) + rekomendasi; delete (Ollama rm)
- [x] **Dataset** — list / preview / create (`/data/*`)
- [x] **Recipes** — repoint ke **task gallery v0.40.0** (25 template); "use" = buat experiment
- [x] **Dashboard** — agregat dari catalog + datasets + tasks
- [x] **Compute** — wired ke `/compute_provider/providers/` nyata (provider "Local" Connected)
- [x] **Auth** — gate password ringan opsional (`APP_PASSWORD` + `AUTH_SECRET` → login + cookie `proxy.ts`, banding **constant-time** + **rate-limit**); bukan multi-user
- [x] **Setup reproducible** — `scripts/setup-v0.40.0.sh` + `start-all.sh` + serve scripts + `docs/SETUP.md`

### ⚠️ Kosong sampai diisi (bukan bug)
- [ ] **Model Registry "downloaded" (TL)** kosong — v0.40.0 tak "download model ke workspace"; base model **by HF id** (trainer pull runtime). Picker fine-tune/eval menyodorkan base HF rekomendasi.

### ❌ Tidak dikerjakan — alasan jujur (tak menghalangi produk)
- [ ] **Multi-user accounts / RBAC** — sengaja di-skip; pakai gate password bersama. TL `fastapi-users` ada bila mau full nanti.
- [ ] **Plugin management** — niche, low value, **usang di v0.40.0** (trainer = task GitHub, bukan plugin lagi).

**Di luar scope (sengaja):** RAG/Documents, Diffusion, Audio (TTS), cloud.

---

## 🔧 Catatan teknis migrasi v0.40.0

**Perubahan paradigma vs v0.30.3:**
- Eksekusi train/eval/export = **compute-provider launch** (bukan plugin+queue). Job bertipe `REMOTE`.
- Inference **dicabut dari backend** → Ollama di host.
- Base model & dataset training **di-pull dari HF by id** saat runtime.
- Skor eval pindah ke **artifacts** (`get_eval_results`).
- Eval fine-tune: harness tak bisa load LoRA adapter dari HF → kita **merge ke base lokal** lalu eval via `model_path`.

**Setup environment (di luar repo, sudah di-script):**
- `scripts/setup/apply-sandbox-patch.sh` — fix bwrap WSL (`/etc/resolv.conf`). Tanpa ini semua job FAILED.
- `scripts/setup/apply-conversations.sh` — tambah router `conversations` ke source TL (chat history server-side), mirror `notes.py`. Idempotent.
- `scripts/setup/install-ollama.sh` — Ollama userspace (`~/.local/bin`, tanpa sudo).
- `scripts/serve/nqr_export_gguf.sh` + `nqr_serve_finetune.sh` + `nqr_merge.sh` — serve/eval fine-tune (merge→GGUF→Ollama / merge-only).
- `scripts/setup-v0.40.0.sh` — orchestrate semua + quota team + experiments + pull model default.
- `scripts/start-all.sh` — start TL + Ollama. `.env.local` — lihat `.env.example`.

→ Detail lengkap di `docs/SETUP.md` + `AI_KNOWLEDGE_LOG.md`.

---

## 🚀 Next Steps (opsional — produk sudah lengkap untuk tujuannya)
1. **Multi-user auth penuh** (TL `fastapi-users`) — kalau mau benar-benar team-ready.
2. **Persist job logs** — TL menghapus logs pasca-selesai (live cuma saat RUNNING); kalau mau riwayat log, simpan sendiri saat job selesai.
3. **Dockerize backend** (source lokal via bind-mount) — sisi app **sudah Docker-ready** (`HOST_RUNNER=docker` + `DOCKER_CONTAINER`, lihat `.env.example`); sisa kerjaan: Dockerfile + GPU passthrough (`--gpus all` + nvidia-container-toolkit) + bwrap-in-Docker.
4. **Rewrite backend ke Rust** — goal jangka panjang (proyek tersendiri).
5. **Deploy/serving lanjutan** — multi-model, versioning.

## Keputusan Tercatat
- Target: **produk self-host untuk tim** (privat, bukan SaaS) · **lokal selamanya**
- Backend: **run from source v0.40.0** (Docker ditinggalkan); rewrite (Rust) ditunda
- Inference: **Ollama** (selaras goal "serve via ollama/vllm/llamacpp")
- Auth: **gate password bersama** (multi-user ditunda) · Lisensi: ditangguhkan (internal)
