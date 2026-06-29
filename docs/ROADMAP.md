# Roadmap & Weekly Report — NQRust-LLMOps

**Update:** 21 Juni 2026 · **Status:** Fase 1 inti **selesai** · Fase 3 sebagian selesai

> Produk LLMOps **self-host untuk tim**, berjalan **lokal** (tanpa cloud). Engine
> training = Transformer Lab + Unsloth; inference via llama.cpp / vLLM / Ollama
> (OpenAI-compatible API). Backend = Transformer Lab (vendored di `backend/`).

---

## Ringkasan Eksekutif

Loop inti LLMOps — **train → fine-tune → eval → serve** — berjalan **end-to-end
dengan data nyata**, dan kini lengkap sampai **deploy jadi API**. Aplikasi
**jujur** (yang tampil = nyata; UI "fantasi" sudah dibuang) dan **lebih aman**
(7 perbaikan dari code review). Tiga fitur besar terakhir — **Generations,
Workflows, Deployments** — sudah live-verified end-to-end.

**Loop lengkap:** Dataset → Fine-tune → Sweep → Eval → Generations → Workflows
(1-klik) → Deployments (API).

---

## Deliverable Terakhir

- **Wiring data nyata:** Tasks (job + logs), Dashboard (agregat), Experiments,
  Recipes, Dataset preview, Serving
- **Fitur baru:** Hyperparameter Sweep, Eval Compare, **Generations** (output
  compare), **Workflows** (pipeline 1-klik), **Deployments** (serve model sbg API)
- **Take-out fitur fantasi** (deploy/usage/cost/quality-scan palsu) → app jujur
- **Bug fix krusial:** tokenizer yang bikin eval/serve model fine-tune gagal diam-diam
- **7 perbaikan code review:** tutup kebocoran API key, validasi response (anti-race),
  error tidak disembunyikan, operasi delete jujur, polling lebih aman
- **Kualitas:** tsc / eslint / test = **0 / 0 / 62**

---

## ✅ FASE 1 — Wire backend TL → UI LLMOps  *(inti selesai)*

**Selesai (live, data nyata):**

- [x] Inference / chat — *Interact*
- [x] Manajemen model: browse / download / load / delete — *Model Registry + picker*
- [x] Fine-tuning (LoRA) — *Fine-tune*
- [x] Hyperparameter sweep — *Fine-tune → Sweep*
- [x] Eval (benchmark) + Compare — *Evals*
- [x] Export GGUF — *Fine-tune / picker*
- [x] Dataset: list / preview / create / delete / download — *Dataset*
- [x] Tasks: monitor job + logs nyata — *Tasks*
- [x] Experiments (list) — *Experiments*
- [x] Recipes: template → experiment — *Recipes*
- [x] Dashboard: agregat nyata — *Dashboard*
- [x] **Generations** (banding output base vs fine-tuned) — *Generations*
- [x] **Workflows** (pipeline train→eval→export 1-klik) — *Workflows*
- [x] **Deployments** (serve model fine-tuned sbg API + lifecycle) — *Deployments*
- [x] Notes (markdown) — *Notes* *(localStorage; server-side menunggu Fase 2)*

**Belum (alasan jelas):**

- [ ] **Auth / teams / users** — *di-skip (keputusan). TL punya `fastapi-users`, feasible kapan saja.*
- [ ] Conversations history (server-side) — *keblok: endpoint tidak ada di image TL → unlock di Fase 2*
- [ ] Plugin management — *dev/admin, niche, low value*

**Di luar scope (sengaja):** RAG/Documents, Diffusion (gambar), Audio (TTS), Compute/cloud.

➡️ **Loop produk Fase 1 = selesai.** Sisa hanya item yang di-skip (auth) atau
yang butuh Fase 2 (notes/conversations server-side).

---

## 🔧 FASE 2 — Run backend dari SOURCE (lepas dari Docker image)  *(prioritas berikutnya)*

**Tujuan:** jalankan backend dari `backend/` (source) lokal, bukan image
`transformerlab/api:latest`.

**Nilai nyata:**
- Unlock **API lengkap** — endpoint yang image tidak punya (mis. **notes** → Notes server-side)
- **Patch di source** — `apply-fixes.sh` jadi bagian source, bukan tempelan rapuh ke container
- **Kontrol penuh** versi backend

**Cara (dari README + scripts):**
```bash
cd backend
./install.sh multiuser_setup   # env conda/uv + deps (sekali, berat)
./run.sh                        # API di http://localhost:8338
```

**Kenyataan teknis:** mesin = Windows → butuh **WSL2 (Ubuntu) + CUDA passthrough**
(scripts berbasis bash/conda/Linux; README: "Linux / WSL").

**Langkah:**
- [ ] 1. Pasang WSL2 + Ubuntu + driver NVIDIA CUDA-for-WSL
- [ ] 2. `./install.sh multiuser_setup` (download besar)
- [ ] 3. `./run.sh` → verifikasi API `:8338` hidup
- [ ] 4. Re-apply patch ke plugin venv lokal (port `apply-fixes.sh`)
- [ ] 5. Repoint app (`INFERENCE_*`) + API key permanen baru
- [ ] 6. Verifikasi loop (chat→fine-tune→eval→serve) setara Docker
- [ ] 7. Wire **Notes server-side** (bonus dari API lengkap)

**Aman:** jalankan source **paralel** dengan Docker dulu (Docker = fallback),
kerjakan di branch `feat/backend-from-source`.

**Catatan:** vendoring sengaja "configure, jangan modifikasi" (ada rencana
rewrite Rust). Jadi **run from source = ya**, **rename/refactor berat = ditunda**.

---

## 🚀 FASE 3 — Sharpen jadi "ultimate"

**Tambah:**
- [x] **Deploy orchestration** — serve model (termasuk fine-tuned) sbg API + lifecycle *(MVP single-GPU; multi-model via Ollama ditunda)*
- [x] **Workflows** — pipeline sekali-klik (train→eval→export)
- [x] **Generations / output diff** — bukti kualitatif fine-tune
- [ ] **Team features** — RBAC, sharing experiment/model *(butuh auth)*
- [ ] **Multi-model serving** — via Ollama hand-off *(butuh install Ollama)* atau vLLM *(produksi)*

**Kurangi/trim:**
- [ ] Buang/jujurin placeholder mock tersisa (**Compute**) sampai ada backend
- [x] Pertajam identitas: LLMOps team-native untuk loop train→eval→deploy

---

## Keputusan Tercatat
- Target: **produk self-host untuk tim** (privat, bukan SaaS publik)
- Deployment: **lokal selamanya** (tanpa cloud)
- Strategi backend: **run from source**, rename/rebrand ditunda
- Lisensi: ditangguhkan (pemakaian internal)
- **Auth:** di-skip untuk sekarang

## Next Steps
1. **Fase 2 — Run from source** (setup WSL2 + verifikasi; unlock Notes/Conversations server-side), atau
2. Polish/trim sisa (Compute placeholder), atau
3. **Auth** (kalau mau team-ready)
