# Roadmap & Status — NQRust-LLMOps

**Update:** 4 November 2026 · **Versi di box:** v0.43.1 · **Prioritas sekarang:** Weight edit (Weight-Space Programming)

> Produk LLMOps **self-host untuk tim**, berjalan **lokal** (tanpa cloud). Training =
> Transformer Lab (v0.40.0) + Unsloth; inference lewat **Ollama**, **vLLM** dan **SGLang**
> (semuanya OpenAI-compatible). Engine training dan inference terpisah.

---

## 🗺️ Ringkasan

| Bagian | Isi | Status |
|--------|-----|--------|
| Fase 1–3 | Fitur LLMOps dengan data nyata, backend dari source di Docker, pengerasan keamanan | ✅ Selesai |
| Engine inference | Ollama, vLLM (multi-LoRA), SGLang (multi-LoRA) | ✅ Selesai |
| Model keputusan (System One) | Fine-tune, serve, eval | ✅ Selesai |
| **Weight edit** | Model Claude mengedit bobot model langsung, tanpa training | 🎯 **Prioritas 1**, belum dimulai |
| VLM, CPU/Edge, Speech, OCR, Platform | Lihat "Setelah Weight edit" | ⏳ Antre |

---

## ✅ Yang sudah selesai

**Loop inti: latih → uji → sajikan**
- **Fine-tune LoRA lewat Unsloth:** SFT, GRPO (reasoning/RL), TTS. Base vision-language (mis. SEA-LION VL) bisa dilatih dengan data teks. Job jalan di GPU dengan riwayat dan log langsung.
- **Eval:** benchmark lm-eval untuk model base Hugging Face maupun hasil fine-tune sendiri, dengan Compare antar-run.
- **Export dan serve:** adapter → merge → GGUF → Ollama, atau base + adapter langsung di vLLM/SGLang.
- **Workflows:** pipeline sekali klik train → eval → export.
- **Sweep:** grid hyperparameter; tiap kombinasi jadi adapter untuk dibandingkan.

**Serving: tiga engine**
- **Ollama:** engine default untuk model GGUF.
- **vLLM:** satu base + banyak adapter LoRA; pasang/lepas adapter tanpa restart.
- **SGLang (v0.42–v0.43.1):**
  - Engine ketiga, dengan kartu di Deployments dan pilihan engine/adapter di Playground.
  - Klien tetap memakai nama `base`/`ask`/…; LLMOps menerjemahkannya ke `base:ask` milik SGLang dan menolak nama yang tidak dilayani.
  - Adapter bisa dipasang dan dilepas tanpa restart. Adapter Unsloth disiapkan otomatis oleh helper di container SGLang.
  - Adapter yang hilang setelah engine restart dipasang ulang otomatis tiap 60 detik (berlaku juga untuk vLLM).
  - Gateway mode SGLang (`GATEWAY_ENGINE=sglang`, layanan `rantai-gateway-sglang`, port 11440) sudah ada di compose, belum dibuat di box.
  - **Teruji di GB10:**
    - Image rilis resmi `lmsysorg/sglang:v0.5.23-cu130`.
    - Jawaban setara vLLM; 8 permintaan paralel 64,5 vs 43,3 tok/s.
    - Uji beban 30 menit: 2.143 permintaan, 0 error.
    - Restart: adapter pulih sendiri.
- **Deployments:** daftar deployment tersimpan di server (bersama antar anggota), test endpoint, dan lifecycle.

**Model keputusan (System One)**
- **Fine-tune `decision`:** Unsloth `FastDecisionModel`, model bahasa + kepala klasifikasi, dataset `{state, questions, gold}`.
- **Serve:** server PyTorch `/v1/systemone` di belakang gateway ber-API-key; kartu "Decision models" di Deployments.
- **Eval Decision:** akurasi, Macro-F1, ECE, Brier, log loss, diagram reliability, kurva otomasi, perbandingan dua run.

**Observability**
- **Traces:** log permintaan dari app dan gateway (opsional, `GATEWAY_TRACE_FILE`).
- **Engine load:** panel langsung dari `/metrics` vLLM dan SGLang: antrean, KV cache, tok/s, TTFT, cache hit, slot LoRA.

**Data dan aset**
- **Hub:** cari dan unduh model/dataset Hugging Face.
- **Tambah dataset:** satu dialog (file, tempel, atau Hugging Face), ditinjau dulu, sampai 100 MB, ke workspace atau S3.
- **Dataset viewer.**
- **Recipes.**
- **Prompt Registry:** prompt sistem disimpan dan diberi versi.
- **Notes** dan **riwayat chat** tersimpan di server.
- **Manajemen:** Tasks (progress dan log langsung), Experiments, Model Registry, Generations (base vs fine-tune), Dashboard, Compute.

**Platform**
- **Backend:** di Docker dengan GPU passthrough.
- **Auth:** gate password bersama (`APP_PASSWORD` + `AUTH_SECRET`), dengan rate-limit login.
- **Keamanan:**
  - Jembatan skrip host anti-injection.
  - Token HF diredaksi dari error.
  - Optimistic UI yang jujur: aksi gagal di-rollback.
  - Detail entitas punya URL sendiri.

---

## 🎯 Prioritas 1 — Weight edit (Weight-Space Programming)

### Latar belakang

Blog *Sparks of Weight-Space Programming* (Takehi dkk., 2 November 2026) menunjukkan model
frontier bisa membaca dan mengedit bobot jaringan saraf secara langsung, tanpa gradien dan
tanpa training.

**Kasus utama**
- GPT-6 Astra diberi bobot Qwen3.5-0.8B di Python dan jatah 50 batch forward pass pada soal latihan.
- Ia menemukan satu arah di MLP layer 15 dan 19 yang menyebabkan *reasoning loop*, lalu membuangnya.
- Yang diubah hanya 0,016% bobot.

**Hasilnya**

| Benchmark | Sebelum | Sesudah |
|---|---|---|
| MATH-500 | 7,9% | 48,1% |
| GSM8K | 13,8% | 67,1% |
| IFEval | 21,0% | 62,3% |

**Catatan**
- **Claude juga mampu:** reproduksi Alex Krentsel menempatkan Claude Opus 5.5 sekitar 20x di eksperimen jaringan pemain game, dekat Astra.
- **Batasannya:** edit ini menghilangkan hambatan, bukan menambah kemampuan. Di Gemma 3 270M, yang jarang loop, hasilnya sekitar 1 poin.

### Keputusan (4 November 2026)

| Keputusan | Isi |
|---|---|
| Bentuk | **Fitur baru di LLMOps** ("Weight edit", di samping Fine-tune). Model hasil edit di-serve lewat LLMOps dan dipakai **RantAI Agents** lewat gateway. |
| Model agen | **Claude Opus 5.5** (tidak ada akses Astra). **Claude Sonnet 5.5** untuk uji coba dan pengembangan. |
| Target pertama | Model Qwen di **Nafs-Aql** (System 1 Qwen3-1.7B, System 2 Qwen3-4B-Thinking-2507), di-fork menjadi versi RantAI. |
| Prioritas | Di atas VLM. |

### Cara kerja fitur (rancangan)

```
Pilih base model + masalah + soal latihan + model agen + anggaran
        │
        ▼
Worker di GB10: bobot bf16 dimuat di sesi Python (GPU)
        │   alat untuk agen:
        │   • run_python    — periksa bobot, hitung, coba edit
        │   • run_batch     — jalankan model pada ≤512 soal latihan (memakai jatah forward pass)
        │   • save_candidate — simpan edit sebagai kandidat
        ▼
Agen Claude (Anthropic API, tool use) — semua langkah, kode dan biaya dicatat
        │
        ▼
Hasil: diff bobot (safetensors jarang) + laporan agen
        │
        ▼
Eval sebelum/sesudah (test set yang TIDAK pernah dilihat agen) + uji retensi
        │
        ▼
Model Registry (versi edit, bisa di-rollback) → export → serve (Ollama / vLLM / SGLang) → RantAI Agents
```

**Aturan yang dipegang sejak awal**
- **Data terpisah:** soal latihan dan test set tidak pernah tercampur. Agen tidak pernah melihat soal benchmark.
- **Anggaran terbatas per run:** jumlah forward pass (10/25/50) dan batas biaya API. Run berhenti kalau batas tercapai.
- **Bisa ditelusuri dan diulang:** tiap edit menyimpan diff, kode yang dijalankan agen, log percakapan, biaya, dan hasil eval.
- **Tidak ada klaim tanpa A/B:** edit baru dianggap berhasil kalau menang di eval yang sama dengan model asli.

### Tahapan

| # | Tahap | Hasil yang dicari | Gerbang lanjut |
|---|---|---|---|
| **W0** | **Persiapan:** API key Anthropic (Console, terpisah dari langganan Claude Code) dengan batas biaya; fork Nafs-Aql ke RantAI-dev; jalankan Nafs-Aql di box dan catat apa yang jalan | Nafs-Aql versi RantAI hidup; akses API siap | Nafs-Aql jalan end-to-end |
| **W1** | **Ukur loop:** Qwen3-1.7B, Qwen3-4B-Thinking-2507 dan Qwen3.5-0.8B (pembanding) di MATH-500 dan GSM8K — akurasi, % jawaban kena batas token, panjang penalaran | Peta "model mana yang punya masalah yang bisa diedit" | Ada model target dengan loop cukup sering; kalau tidak ada, pilih masalah atau model lain |
| **W2** | **Prototipe harness (skrip, tanpa UI):** worker Python di GB10 + agen lewat Anthropic API, model Sonnet 5.5 | Satu run lengkap tercatat: langkah, kode, biaya, kandidat edit | Harness stabil, biaya per run terukur |
| **W3** | **Reproduksi** hasil blog pada Qwen3.5-0.8B dengan Opus 5.5 (jatah 50 batch); bandingkan dengan model hasil edit yang dirilis penulis | Bukti metodenya jalan di tangan kita, plus biaya nyatanya | Kenaikan MATH-500 bermakna; kalau gagal, evaluasi ulang sebelum membangun UI |
| **W4** | **Terapkan ke Nafs-Aql:** edit System 2 dan/atau System 1 → GGUF Q4_K_M → A/B dengan protokol Nafs-Aql (akurasi, token penalaran, waktu di CPU, verifier) | Model Nafs-Aql yang lebih akurat dan/atau lebih cepat | Edit bertahan setelah kuantisasi 4-bit dan menang A/B |
| **W5** | **Fitur LLMOps "Weight edit":** halaman/metode baru; job sebagai task dengan log langkah agen dan biaya langsung; diff + laporan; eval sebelum/sesudah; versi di Model Registry; export dan serve | Tim bisa menjalankan edit dari UI tanpa skrip | Uji end-to-end di box, sama seperti SGLang |
| **W6** | **Ke RantAI Agents:** model hasil edit di-serve di belakang gateway dan dipakai RantAI Agents; eval end-to-end di skenario nyata | Model hasil edit melayani pengguna | Lulus eval dan uji beban |

### Prasyarat dan risiko

| Hal | Catatan |
|---|---|
| API key Anthropic | Langganan Claude Code tidak bisa dipakai server LLMOps; perlu key Console dengan batas biaya. Sonnet 5.5 untuk W2, Opus 5.5 untuk W3–W4. |
| Biaya per run | Belum diketahui (blog tidak melaporkan); diukur di W2 dan dibatasi per run. |
| Hasilnya masih baru | Satu blog, umur beberapa hari, ada kritik. Karena itu W1 dan W3 menjadi gerbang sebelum membangun UI. |
| Kuantisasi | Nafs-Aql memakai GGUF 4-bit; belum diketahui apakah edit kecil bertahan setelah kuantisasi (dicek di W4). |
| Batas metode | Edit membuang hambatan (mis. loop), bukan menambah pengetahuan. Untuk pengetahuan baru tetap fine-tune atau RAG. |
| Box GB10 | GPU dipakai bersama vLLM, SGLang dan training; disk kosong sekitar 160 GB. |

---

## ⏳ Setelah Weight edit (urut prioritas)

1. **Vision — VLM:** dataset bergambar, input gambar di Playground dan Evals, serving dengan gambar. Fine-tune base VL dengan data teks sudah jalan.
2. **Engine — CPU/Edge:** fine-tune di GPU, deploy ke CPU/edge (GGUF lewat llama-server, termasuk model keputusan), dan benchmark tok/s. Bersinggungan dengan Nafs-Aql, yang memang dibuat untuk CPU.
3. **Speech — ASR lalu TTS:** fondasi audio bersama (dataset, trainer, serving, perekam/pemutar di Playground); ASR dulu karena WER/CER bisa dihitung otomatis.
4. **Vision — OCR:** setelah VLM dievaluasi, putuskan perlu jalur terpisah atau cukup VLM.
5. **Platform:** port Rust (bagian keamanan lebih dulu), performa backend, UI/UX oleh desainer (termasuk sidebar yang tidak menutup di layar ponsel).

**Lainnya (belum dijadwalkan)**
- **Akun per pengguna / RBAC:** untuk sekarang masih gate password bersama.
- **Simpan log job:** TL menghapus log setelah job selesai.
- **Versioning deployment.**
- **Gateway SGLang di box:** migrasi RantAI Agents ke SGLang ditunda (keputusan 2 November 2026).

**Di luar scope produk:** RAG/Documents, Diffusion, cloud/SaaS.

---

## 📌 Keputusan tercatat

- Target: **produk self-host untuk tim** (privat, bukan SaaS), **lokal selamanya**.
- Backend: **run from source v0.40.0** di Docker.
- Inference: **Ollama, vLLM, SGLang** (SGLang di GB10: image rilis resmi `v0.5.23-cu130`).
- Training: **Unsloth**.
- Edit bobot: **Claude Opus 5.5** sebagai agen, **Sonnet 5.5** untuk uji (4 November 2026).
- Auth: **gate password bersama** (multi-user ditunda). Lisensi: ditangguhkan (internal).
- **Prinsip data:** tidak menampilkan data/tombol palsu sebagai nyata. Setiap klaim performa harus didukung A/B.
