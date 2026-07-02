# Roadmap & Status — NQRust-LLMOps

**Update:** 2 Juli 2026 · **Status:** Loop LLMOps penuh live & terverifikasi.

> Produk LLMOps **self-host untuk tim**, berjalan **lokal** (tanpa cloud). Training =
> Transformer Lab (v0.40.0) + Unsloth (SFT, GRPO, TTS); inference via **Ollama**
> (OpenAI-compatible). Engine training & inference terpisah.

**Kondisi build:** `tsc 0 error · eslint 0 warning · vitest 94 pass · next build sukses (20/20 halaman)`.

---

## 🗺️ Fase Pengembangan

| Fase | Isi | Status |
|------|-----|--------|
| **Fase 1** | Wire semua fitur LLMOps ke UI dengan data nyata | ✅ Selesai |
| **Fase 2** | Jalankan backend dari source lokal (v0.40.0), lepas dependency prebuilt | ✅ Selesai |
| **Fase 3** | Backend di Docker (bind-mount source), pengerasan keamanan/kualitas, semua fitur real (mock dibuang), detail via URL route | ✅ Selesai |
| **Fase 4** | Team-ready lanjutan (lihat "Fase berikutnya") | ⏳ Belum |

---

## 🏗️ Arsitektur

Tiga proses lokal, engine training & inference terpisah:

| Proses | Port | Peran |
|--------|------|-------|
| **Transformer Lab** (Docker) | `:8339` | Orchestrator: train / eval / export / jobs / data / notes. Compute-provider lokal (sandbox bwrap), GPU passthrough |
| **Ollama** | `:11434` | Engine inference: chat + serving model |
| **Next.js (BFF)** | `:3000` | Jembatan UI ↔ backend; auth gate |

**Catatan teknis:**
- Eksekusi train/eval/export = **compute-provider launch** (job bertipe `REMOTE`), bukan plugin+queue.
- Base model & dataset training **ditarik dari Hugging Face by-id saat runtime** (tidak di-download dulu ke workspace).
- Inference dicabut dari backend → Ollama.
- Eval fine-tune: adapter di-**merge ke base lokal** lalu dieval via `model_path`.

---

## ✅ Fitur yang SUDAH ada

**Loop inti (train → eval → serve):**
- **Chat / Interact** — streaming via Ollama `/v1`; picker model.
- **Fine-tune (LoRA)** — 3 metode via Unsloth: **SFT**, **GRPO** (reasoning/RL), **TTS** (text-to-speech). Submit ke compute-provider → job jalan di GPU; history + log nyata.
- **Eval (benchmark)** — lm-eval harness; eval model base HF *atau* fine-tune sendiri. Skor `acc` + Compare.
- **Export + Serve** — adapter → merge → GGUF → Ollama → chat dengan model latihan sendiri.
- **Workflows** — pipeline 1-klik train → eval → export.
- **Sweep** — grid hyperparameter; tiap kombinasi jadi adaptor untuk dibandingkan.

**Manajemen & monitoring:**
- **Tasks** — monitor job + progress live (polling) + live logs (tail saat RUNNING). Detail lewat URL (`?task=`).
- **Experiments** — list + detail; KPI dihitung dari task nyata. Detail lewat URL (`/experiments/[id]`).
- **Model Registry** — model Ollama nyata (servable) + delete. Detail lewat URL (`/models/[id]`).
- **Deployments / Serve** — serve model sebagai API + test endpoint + lifecycle. Daftar deployment tersimpan **server-side (shared antar anggota)**.
- **Generations** — banding output base vs fine-tuned.
- **Dashboard** — agregat nyata (model + dataset + job).
- **Compute** — provider nyata dari `/compute_provider/providers/`.

**Data & aset:**
- **Hub** — cari & download model GGUF dari Hugging Face (`ollama pull hf.co/...`) dengan filter + pilih quant + progress bar. Tab Datasets (cari + "use in fine-tune" → prefill ke form).
- **Dataset** — viewer dataset TL + download sample JSONL + preview live.
- **Recipes** — task gallery v0.40.0; "use" = buat experiment.
- **Notes** — server-side (tersimpan di TL, team-visible).
- **Chat history** — server-side (router `conversations` di TL, team-visible).

**Platform:**
- **Backend di Docker** — container dari source lokal, GPU passthrough.
- **Auth** — gate password bersama (`APP_PASSWORD` + `AUTH_SECRET`; banding constant-time + rate-limit login).
- **Keamanan** — jembatan host script anti-injection (argv-form + validasi id); HF token diredaksi dari error.
- **Kualitas** — optimistic UI jujur (aksi gagal → rollback + toast); semua fetch ke TL via `tlFetch` (timeout); error read/list ke-log; detail entity punya URL sendiri (share/bookmark/back).

---

## ⏳ Fitur yang BELUM ada

| Fitur | Alasan |
|-------|--------|
| **Multi-user accounts / RBAC** | Sengaja ditunda; pakai gate password bersama. TL `fastapi-users` tersedia bila mau. |
| **Persist job logs** | TL menghapus log setelah job selesai (live hanya saat RUNNING); riwayat log perlu disimpan sendiri. |
| **Serve fine-tune di dalam Docker** | Serving saat ini di host (jaringan container ↔ Ollama). |
| **Plugin management** | Usang di v0.40.0 (trainer = task GitHub, bukan plugin). |

**Di luar scope produk:** RAG/Documents, Diffusion, cloud/SaaS.

---

## 🚀 Fase berikutnya (opsional)

1. **Multi-user auth penuh** (TL `fastapi-users`) — untuk benar-benar team-ready.
2. **Persist job logs** — simpan riwayat log saat job selesai.
3. **Serve fine-tune di dalam Docker** — jaringan container ↔ inference.
4. **Deploy/serving lanjutan** — multi-model, versioning.
5. **Rewrite backend ke Rust** — goal jangka panjang (proyek tersendiri).

---

## 📌 Keputusan Tercatat

- Target: **produk self-host untuk tim** (privat, bukan SaaS) · **lokal selamanya**.
- Backend: **run from source v0.40.0**, dijalankan **di Docker** (bind-mount source lokal).
- Inference: **Ollama** (selaras goal serve via ollama/vllm/llama.cpp).
- Training: **Unsloth** (SFT + GRPO + TTS).
- Auth: **gate password bersama** (multi-user ditunda) · Lisensi: ditangguhkan (internal).
- **Prinsip data:** tidak menampilkan data/tombol palsu sebagai nyata.
