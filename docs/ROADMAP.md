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

Bagian ini ditulis supaya tim lain bisa mengerjakannya tanpa konteks tambahan. Setiap
area menjelaskan: apa itu, kenapa perlu, titik awal di kode, lingkup kerja, tahapan,
ukuran selesai, dan risiko. Urutannya prioritas. Satu area boleh dikerjakan paralel
dengan area lain bila timnya berbeda.

### Panduan umum untuk tim

| Hal | Di repo ini |
|---|---|
| Arsitektur | Next.js sebagai BFF (`src/app/api/*`) di depan backend Transformer Lab (`:8339`) dan engine inference. UI per fitur di `src/modules/<fitur>/`, logika server di `src/lib/`. Penjelasan lengkap: `docs/ARSITEKTUR.md`. |
| Trainer | Ada di `trainers/<nama>/train.py`. Job training meng-clone trainer **dari GitHub `main`** saat dijalankan, jadi push trainer sudah cukup tanpa rebuild backend. Contoh: `trainers/unsloth-llm-train/` (SFT/GRPO, deteksi base VL), `trainers/unsloth-decision-train/`. Definisi job di `src/lib/finetune.ts`. |
| Status fitur | `src/lib/feature-status.ts` menandai fitur `live` / `simplified` / `mock` / `planned`. Fitur baru dimulai `planned`, naik ke `live` hanya setelah jalan dengan data nyata. **Tidak ada tombol atau data palsu yang tampil seperti nyata.** |
| Serving | Ollama (GGUF), vLLM dan SGLang (safetensors + LoRA). Pola engine: `src/lib/inference-engines.ts`, container terkelola: `src/lib/serve-*-container.ts`, gateway API key: `docker/backend/gateway.py` (image di `docker/gateway/`). |
| Export | `scripts/serve/rantai_export_gguf.sh` (merge adapter → GGUF → Ollama), `rantai_merge.sh`. |
| Kualitas | `npx tsc --noEmit`, `npm run lint`, `npx vitest run` harus bersih sebelum commit. Klaim performa dibuktikan dengan A/B di box GB10, bukan perkiraan. |
| Box uji | GB10 (ARM64, CUDA 13, memori GPU bersama ±128 GB, disk kosong ±160 GB) lewat Portainer. GPU dipakai bersama vLLM, SGLang dan training; cek ruang GPU sebelum menjalankan job besar. |

---

### 1. Vision — VLM (Vision-Language Model)

**Apa itu.** Model yang menerima **gambar + teks** dan menjawab dengan teks, misalnya
menjelaskan foto, membaca grafik, menjawab soal bergambar, atau memeriksa dokumen
foto. Contoh base: Qwen-VL, Gemma-3 (varian vision), SEA-LION VL.

**Kenapa perlu.** Banyak kasus pengguna (materi pelajaran bergambar, dokumen, foto
lapangan) tidak bisa dilayani model teks saja. Base yang sudah kita pakai (SEA-LION v4
8B **VL**, SEA-LION 4B yang hanya ada versi VL) sebenarnya sudah punya mata, tapi
LLMOps baru memakainya untuk teks.

**Titik awal (sudah ada).**
- `trainers/unsloth-llm-train/train.py` sudah mendeteksi base VL (`vision_config`) dan
  memakai `FastModel` dengan **vision tower dibekukan** (`finetune_vision_layers=False`):
  fine-tune VL dengan data teks saja.
- vLLM dan SGLang di box sudah menyajikan base VL (Qwen3-VL), jadi engine-nya sanggup
  menerima gambar lewat format OpenAI `image_url`.
- Belum ada: dataset bergambar, input gambar di Playground, eval bergambar, export VL ke GGUF.

**Lingkup kerja.**
1. **Dataset bergambar:** format `{messages:[{role, content:[{type:"image", …},{type:"text", …}]}]}`
   (gambar sebagai path/URL di workspace atau S3). Dialog "Tambah dataset" menerima
   folder gambar + JSONL, menampilkan pratinjau gambar dan teks, dan memvalidasi gambar yang hilang.
2. **Trainer:** mode vision di `unsloth-llm-train` dengan `FastVisionModel`, opsi melatih
   lapisan vision (`finetune_vision_layers`) dan/atau bahasa, plus collator gambar.
   Batasi resolusi/jumlah token gambar supaya muat di GPU bersama.
3. **Playground:** unggah/tempel gambar di chat, dikirim sebagai `image_url` (base64)
   ke vLLM/SGLang. Riwayat chat menyimpan gambar.
4. **Evals:** benchmark VL (mis. MMMU, ChartQA, DocVQA lewat lm-eval/lmms-eval) dan eval
   dataset sendiri (jawaban vs kunci) dengan perbandingan base vs fine-tune.
5. **Serving dan export:** vLLM/SGLang (safetensors + LoRA) jalur utama. GGUF/Ollama
   untuk VL butuh file proyektor terpisah (`mmproj`); dukung kalau arsitekturnya didukung llama.cpp.

**Tahapan.** (a) Playground + serving gambar di vLLM/SGLang (paling cepat terasa) →
(b) dataset bergambar → (c) trainer vision → (d) eval VL → (e) export GGUF bila didukung.

**Ukuran selesai.** Satu siklus penuh di box: unggah dataset bergambar → fine-tune →
eval naik dibanding base di test set bergambar yang terpisah → serve → tanya dengan
gambar di Playground dan lewat gateway.

**Risiko.** Memori GPU naik tajam karena token gambar; adapter LoRA yang menyentuh
vision tower perlu dicek dukungannya di vLLM/SGLang; GGUF VL tidak tersedia untuk semua arsitektur.

---

### 2. Engine — CPU/Edge

**Apa itu.** Melatih di GPU, lalu **menjalankan model di mesin tanpa GPU**: server
CPU biasa, laptop, mini-PC, atau perangkat edge (ARM). Caranya: model dikompres ke
GGUF (4–8 bit) dan dijalankan dengan `llama-server` (llama.cpp).

**Kenapa perlu.** Banyak pelanggan self-host tidak punya GPU, atau butuh model jalan
di lokasi (sekolah, kantor cabang, offline). Nafs-Aql membuktikan model 1,7B–4B bisa
melayani di 4 core CPU. Selain itu, model keputusan (System One) kecil dan cocok di CPU.

**Titik awal (sudah ada).**
- `scripts/serve/rantai_export_gguf.sh`: merge adapter → GGUF (default `q8_0`) → Ollama.
- Ollama sudah jalan di CPU, tapi belum ada target "deploy ke mesin lain" dan belum ada
  pengukuran kecepatan/akurasi per kuantisasi.
- Model keputusan: training jalan untuk semua base; serving GGUF baru teruji di Qwen3.5.

**Lingkup kerja.**
1. **Pilihan kuantisasi saat export:** Q4_K_M, Q5_K_M, Q8_0, F16, dengan perkiraan ukuran file dan RAM.
2. **Target deploy `llama-server`:** paket siap jalan (binari/container + GGUF + config)
   untuk x86 dan ARM64, termasuk perintah satu baris untuk mesin tujuan. Endpoint OpenAI-compatible.
3. **Benchmark:** tok/s (prefill dan decode), waktu ke token pertama, RAM puncak, dan
   **penurunan akurasi** dibanding model GPU di eval yang sama. Hasil tampil di Model Registry.
4. **Model keputusan di CPU:** export dan serving GGUF untuk base lain selain Qwen3.5,
   atau jalur ONNX bila GGUF tidak bisa; ukur latensi per keputusan.
5. **Registrasi mesin edge:** daftar mesin tujuan, versi model yang terpasang, dan status hidup.

**Tahapan.** (a) kuantisasi + benchmark di box (CPU ARM GB10) → (b) paket `llama-server` →
(c) uji di satu mesin x86 tanpa GPU → (d) model keputusan di CPU → (e) registrasi mesin.

**Ukuran selesai.** Model hasil fine-tune bisa di-deploy dari UI ke mesin tanpa GPU,
menjawab lewat API, dan halaman model menampilkan tok/s serta selisih akurasinya.

**Risiko.** Kecepatan CPU sangat bergantung pada bandwidth memori (Nafs-Aql: 60–95% dari
batas mesin); angka harus diukur di mesin target, bukan di box. Kuantisasi 4-bit bisa
menurunkan akurasi tugas tertentu, jadi selalu ditampilkan bersama hasil eval.

---

### 3. Speech — ASR lalu TTS

**Apa itu.**
- **ASR (Automatic Speech Recognition):** suara → teks (transkripsi). Contoh: Whisper.
- **TTS (Text-to-Speech):** teks → suara. Contoh: Orpheus.

**Kenapa perlu.** Asisten suara, transkripsi kelas/rapat, aksesibilitas, dan aksen/istilah
lokal (Bahasa Indonesia dan bahasa daerah) yang sering buruk di model umum. Fine-tune
memperbaiki hal itu.

**Kenapa ASR dulu.** Hasil ASR bisa dinilai otomatis dengan **WER/CER** (persentase kata/huruf
salah). Kualitas TTS butuh penilaian manusia (MOS) atau metrik tidak langsung, jadi lebih
lambat diuji.

**Titik awal (sudah ada).**
- Fine-tune **TTS** sudah ada sebagai metode (trainer Unsloth TTS dari galeri Transformer Lab,
  base Orpheus; `src/lib/finetune.ts`). Belum ada serving TTS, pemutar audio, maupun eval TTS.
- Belum ada apa pun untuk ASR.

**Lingkup kerja (fondasi audio bersama).**
1. **Dataset audio:** pasangan `{audio, text}` (wav/mp3/flac + transkrip), pratinjau dengan
   pemutar, normalisasi sample rate, deteksi durasi/klip rusak, import dari Hugging Face (mis. Common Voice).
2. **Trainer ASR:** fine-tune Whisper (Unsloth atau Transformers) sebagai metode baru di Fine-tune.
3. **Eval ASR:** WER/CER di test set terpisah, base vs fine-tune, contoh salah transkripsi.
4. **Serving ASR:** endpoint `/v1/audio/transcriptions` (format OpenAI), lewat vLLM (mendukung
   Whisper) atau `faster-whisper`/`whisper.cpp` untuk CPU.
5. **Playground:** perekam mikrofon / unggah file → transkrip.
6. **TTS lanjutan:** serving TTS (`/v1/audio/speech`), pemutar audio di Playground, eval
   (ASR balik untuk mengukur kejelasan + penilaian manusia).

**Tahapan.** (a) dataset audio → (b) serving Whisper base + Playground → (c) trainer ASR →
(d) eval WER/CER → (e) serving + Playground TTS → (f) eval TTS.

**Ukuran selesai.** ASR: fine-tune Whisper menurunkan WER di test set Bahasa Indonesia
dibanding base, bisa dipanggil lewat API dan dicoba dengan mikrofon di Playground.
TTS: model hasil fine-tune bisa diputar di Playground dan dipanggil lewat API.

**Risiko.** File audio besar (penyimpanan dan unggahan); lisensi dataset suara; TTS
butuh komponen dekoder audio tambahan saat serving.

---

### 4. Vision — OCR

**Apa itu.** Mengubah **gambar/PDF dokumen menjadi teks terstruktur** (paragraf, tabel,
rumus), misalnya buku pelajaran hasil scan, formulir, atau faktur.

**Kenapa perlu.** Korpus RAG dan dataset fine-tune banyak yang berupa PDF/scan. Kualitas
OCR menentukan kualitas materi yang masuk ke model (contoh: kunci soal latihan hanya
benar bila teks bukunya bersih).

**Kenapa setelah VLM.** VLM modern sering bisa melakukan OCR sendiri. Setelah VLM
dievaluasi, baru diputuskan: cukup VLM, atau perlu jalur OCR khusus.

**Titik awal (sudah ada).**
- Di box sudah berjalan layanan **MinerU** (`shirologic/mineru-server:gb10-blocks`) untuk
  mengurai dokumen/PDF. Belum terhubung ke LLMOps.

**Lingkup kerja.**
1. **Bandingkan tiga jalur** pada set dokumen yang sama dengan kunci teks:
   (a) MinerU yang sudah ada, (b) VLM base/fine-tune (dari area 1), (c) OCR klasik (mis. PaddleOCR).
   Ukur CER/WER, akurasi tabel, kecepatan per halaman.
2. **Keputusan:** satu jalur default, ditulis di bagian "Keputusan tercatat".
3. **Integrasi:** "Dokumen → dataset" di dialog Tambah dataset (unggah PDF → teks
   terstruktur → ditinjau → disimpan), dan endpoint OCR lewat gateway.
4. **Fine-tune OCR** (bila jalur VLM dipilih): dataset `{gambar halaman, teks benar}` memakai trainer vision dari area 1.

**Ukuran selesai.** Unggah PDF hasil scan di LLMOps → teks terstruktur dengan CER yang
terukur dan tercatat → bisa langsung dipakai sebagai dataset.

**Risiko.** Dokumen bahasa Indonesia dengan tabel/rumus sulit untuk semua jalur; perlu
set evaluasi berlabel milik sendiri.

---

### 5. Platform

**Apa itu.** Pekerjaan fondasi yang tidak menambah fitur ML baru, tapi menentukan apakah
LLMOps layak dipakai tim dan dijual sebagai produk self-host.

**Lingkup kerja.**
1. **Port Rust (bagian keamanan lebih dulu).** Backend sekarang = Transformer Lab (Python)
   yang di-vendor. Tujuan jangka panjang: backend Rust. Mulai dari bagian yang paling
   sensitif: auth/sesi, gateway API key, dan jembatan eksekusi perintah host (yang sekarang
   dibatasi allowlist). Ganti per bagian dengan kontrak API yang sama, bukan tulis ulang sekaligus.
2. **Performa backend.** Ukur dulu: waktu respons API daftar job/model/dataset, polling Tasks,
   dan waktu start job. Perbaiki yang paling lambat (cache, pagination, mengurangi polling).
3. **UI/UX oleh desainer.**
   - Audit seluruh halaman dan sistem desain yang konsisten.
   - Tampilan ponsel: sidebar tidak menutup di layar ponsel, sehingga semua halaman sempit (bug yang sudah diketahui).
   - Alur pengguna baru dari login sampai model pertama ter-serve.
4. **Akun per pengguna / RBAC.** Sekarang satu password bersama. Butuh akun per orang,
   peran (admin, engineer, viewer), dan jejak siapa melakukan apa. Transformer Lab punya
   `fastapi-users` yang bisa dipakai.
5. **Simpan log job.** Transformer Lab menghapus log setelah job selesai; LLMOps harus
   menyimpan salinannya supaya riwayat training bisa diperiksa.
6. **Versioning deployment.** Setiap deployment mencatat versi model/adapter, config, dan
   bisa di-rollback.

**Ukuran selesai per butir.** Diukur sebelum/sesudah (waktu respons, uji keamanan, uji
pengguna). Port Rust per bagian dianggap selesai bila kontrak API dan tes lama tetap lulus.

---

**Lainnya (belum dijadwalkan)**
- **Gateway SGLang di box:** migrasi RantAI Agents ke SGLang ditunda (keputusan 2 November 2026).
  Layanan `rantai-gateway-sglang` sudah ada di compose bila diputuskan lanjut.

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
