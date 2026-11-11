# Rencana lanjutan VLM: menutup celah setelah v0.44.0

**Ditulis:** 8 November 2026 (Opus 5.5), untuk dieksekusi dengan Sonnet 5.5.
**Dasar:** status jujur per 8 Nov ([UJI-END-TO-END.md](UJI-END-TO-END.md) §9, [RENCANA-VLM.md](RENCANA-VLM.md)) dan
pemeriksaan kode dan box hari ini. Klaim yang belum dicek ditandai **[verifikasi]** dan harus dicek dulu sebelum dikerjakan.

## Keputusan pengguna (8 November 2026)

- **Paket B jalan, dibatasi satu jam training** (karena presentasi jam 13:00): 3.200 baris dari `unsloth/LaTeX_OCR`, 1 epoch,
  bukan 10.000 baris. Satu jam tidak cukup untuk menaikkan kualitas banyak; yang utama dari paket B adalah jalur dataset HF
  (F3b), kenaikan skor adalah bonus yang diukur apa adanya.
- **Paket A ditunda:** belum ada kebutuhan VLM di RantAI Agents. **Repo dan produksi RantAI Agents tidak diubah.** Temuan
  tentang gambar yang keluar ke cloud tetap dicatat di bagian paket A sebagai bahan keputusan nanti.
- **Push ke `main` boleh, tanpa baris `Co-Authored-By` Claude.** Rilis baru belum diputuskan.

## Hasil paket B (8 November 2026)

- **F3b selesai:** trainer punya `max_train_rows`/`max_eval_rows`; Hub menandai dataset bergambar dan membuka form vision; satu job
  vision dari dataset HF (`unsloth/LaTeX_OCR`, 3.200 baris) selesai `COMPLETE` di GPU. Dikirim lewat API, bukan klik form.
- **Q tidak membaik:** exact 13,7% / CER 0,246 / ChartQA 56,7%, di bawah `tl-3ep` (16,0% / 0,198 / 62,7%). Gerbang (≥ 20% dan CER
  < 0,198) tidak tercapai. Satu jam training tidak cukup untuk menguji hipotesis "data lebih banyak"; 3.200 baris hanya 5% dari split train.
  Paket B penuh (10.000–20.000 baris) tetap belum dijalankan.

## Hasil paket C (11 November 2026)

- SGLang v0.5.23 menyajikan adapter VL (bahasa saja) setelah entrypoint diberi `--enable-multimodal` (sebelumnya Gemma-3 VL
  diperlakukan sebagai model teks). Nama kunci adapter tidak perlu dipetakan.
- Gerbang tidak tercapai: `tl3ep` 11,0% / CER 0,281 di SGLang vs 16,0% / 0,198 di vLLM. Base juga lebih buruk di SGLang
  (CER 0,541 vs 0,417), jadi selisihnya di engine. Untuk VL, vLLM tetap engine yang disarankan.
- Keputusan pengguna 11 Nov: **Weight edit berhenti dulu.**

## Ringkasan dan urutan

| Urut | Paket | Menutup butir | Kenapa urutan ini | Perkiraan |
|---|---|---|---|---|
| **1** | **B. Dataset HF langsung + model demo yang lebih baik** | F3b, Q | Sepenuhnya di LLMOps; kodenya sudah 80% ada; training jalan sendiri tanpa ditunggui; demo ke Pak Risman langsung lebih meyakinkan | 1 hari kode + 3–6 jam GPU |
| **1 (paralel)** | **A. VLM lokal untuk RantAI Agents, tahap ukur** | R, celah gateway di F2 | Nilai paling besar: hari ini RantAI Agents mengirim gambar ke cloud. Tahap ukur tidak mengubah produksi apa pun | 1–2 hari |
| 2 | C. Adapter VL di SGLang | G8 | Murah, memakai adapter dari paket B | ½ hari |
| 3 | D. Evaluasi GGUF VL + jalur export dari UI | F7 | Mengubah "satu gambar" jadi angka; sekaligus data pertama CPU/Edge | 1–1½ hari |
| 4 | E. Benchmark VL standar (lmms-eval) | F6.2 | Paling sedikit mengubah keputusan; jalan sendiri semalaman | 1 hari + waktu GPU |
| — | G9, G10 (gateway SGLang, migrasi RantAI Agents ke SGLang) | — | **Tidak dikerjakan** tanpa keputusan baru. Ditunda sejak 2 Nov; membuat gateway tanpa pemakai tidak menambah nilai | — |

**Rekomendasi:** mulai paket B dan tahap ukur paket A bersamaan. Training B makan GPU berjam-jam tanpa perlu ditunggui;
pengukuran A memakai vLLM 8B produksi yang sudah jalan, tidak menambah beban memori. Keduanya aman berjalan bersamaan
selama vLLM 4B uji dimatikan saat training.

---

## Aturan untuk eksekutor (berlaku semua paket)

1. **Produksi** (`rantai-vllm-8b`, `rantai-sglang-8b`, `rantai-frontend`, `rantai-backend`, gateway, RantAI Agents) **tidak
   diubah** kecuali langkahnya menyebut begitu dan pengguna sudah setuju di sesi itu. Membaca status dan log boleh.
2. **Memori host:** sisakan ≥ 8 GiB `MemAvailable` (ukur dari dalam kontainer, bukan dari laptop). Training 4B memakai
   ±17 GiB dan vLLM/SGLang 4B ±13 GiB; jangan jalankan keduanya bersamaan.
3. **Kontainer uji** diberi label `owner=evan` dan `purpose=<paket>`, `RestartPolicy: no`, dan dihentikan setelah dipakai.
4. **Commit:** hanya kalau pengguna meminta; atas nama Idham Multazam; **tanpa** baris `Co-Authored-By` atau atribusi
   Claude. Trainer harus di-push ke `main` sebelum job Transformer Lab bisa memakainya (TL meng-clone dari GitHub).
5. **Kualitas:** `npx tsc --noEmit`, `npx vitest run`, eslint pada berkas yang berubah, dan tes Python trainer harus bersih.
   `node_modules` repo dibangun di Windows: jalankan tes di salinan Linux dengan Node 22 (`npm ci`).
6. **Angka:** setiap klaim kualitas memakai 300 soal held-out yang sama (`latex-ocr-test`, `chartqa-test` di frontend
   uji :3010) dan dibandingkan dengan galat standar (±2 poin untuk exact match di 300 soal). Laporkan juga yang gagal.
7. **Jangan baca rahasia.** Untuk RantAI Agents, cukup periksa nama variabel atau nilai yang bukan kunci.

---

## Paket B — Dataset HF langsung dan model demo yang lebih baik (F3b + Q)

### Fakta hari ini
- Trainer vision **sudah** bisa memuat dataset Hugging Face: deteksi kolom gambar otomatis, pemetaan `image_column`,
  `answer_column`, `prompt_column`, `prompt_text` (`trainers/unsloth-vision-train/vlm_data.py:549-602`, `:743-767`).
- Form Fine-tune sudah punya kolom itu (`src/modules/finetune/components/finetune-form.tsx:113-116`, `:495-498`), dan
  `buildVisionParameters` mengirimnya (`src/lib/finetune.ts:798`).
- Hub: tombol "Use in fine-tune" hanya mengirim `?dataset=<id>` (`src/modules/hub/components/hub-datasets.tsx:51-53`), tidak
  tahu dataset punya kolom gambar dan tidak memilih metode vision.
- **Jalur HF belum pernah dijalankan di GPU.** Semua job vision memakai dataset ZIP `vlm-e2e-latex-train`.
- Dua masalah nyata di jalur HF yang harus diperbaiki dulu:
  - **Tidak ada batas baris.** `unsloth/LaTeX_OCR` punya 68.686 baris train; satu epoch penuh ±19 jam di GPU bersama.
  - **Eval di tengah training tidak dibatasi.** Trainer dengan benar tidak memakai split `test` (`_hf_eval_split_name`,
    `vlm_data.py:687-691`): ia memakai `validation`/`val`/`eval`/`dev`, atau 10% hold-out dari train. LaTeX_OCR hanya punya
    `train` dan `test`, jadi eval-nya 10% hold-out = 6.869 gambar yang dievaluasi tiap 50 langkah. Itu lebih lama dari
    training-nya sendiri.
- Prompt latih harus sama persis dengan prompt di set uji: `make_demo_dataset.LATEX_PROMPT` (*"Tulis kode LaTeX untuk rumus di
  gambar ini. Jawab hanya dengan kodenya."*). Set uji 300 soal diambil dari split `test`, jadi melatih dari split `train`
  tidak bocor.

### Langkah
1. **Trainer** (`vlm_train_utils.py` `VisionParams`, `vlm_data.py`):
   - `max_train_rows` (default 0 = semua): subsampel berbenih dari split train.
   - `max_eval_rows` (default 300): batas eval di tengah training, berlaku untuk semua sumber. Hold-out tetap diambil
     dari train **sebelum** subsampel train, supaya baris eval tidak pernah ikut dilatih.
   - Pemilihan split eval yang sekarang dipertahankan (tidak pernah `test`).
   - Tes tanpa GPU (pakai `hf_loader` palsu, sudah ada polanya): subsampel berbenih stabil, batas eval, hold-out tidak
     beririsan dengan train.
2. **Frontend:** `buildVisionParameters` dan route submit menerima `maxTrainRows`, `maxEvalRows` (validasi angka, sama seperti
   `maxPixels`). Form vision: dua kolom angka itu, dengan keterangan perkiraan waktu (±1 detik per contoh per epoch di GB10,
   dari job 2.000 baris = 32 menit).
3. **Hub (F3b):** saat dataset dipilih, ambil fitur kolomnya **[verifikasi: endpoint mana yang dipakai Hub sekarang,
   `src/app/api/hub/datasets/route.ts`; datasets-server `/info?dataset=` memberi `features`]**. Bila ada kolom bertipe
   `Image`, tombol menjadi "Use in vision fine-tune" dan membuka `/finetune?dataset=<id>&method=vision&imageColumn=<kolom>`.
   Form membaca query itu. Tes komponen + tes route (mock fetch). Flip status fitur hanya setelah langkah 5 lulus.
4. **Push trainer** ke `main` (atas izin pengguna), lalu satu job kecil lewat UI: `unsloth/LaTeX_OCR`, `maxTrainRows=200`,
   `maxSteps=10`, `promptText` = `LATEX_PROMPT`, `answerColumn=text`. Gerbang: job `COMPLETE`, log menyebut sumber HF, kolom
   yang terdeteksi, dan sumber eval yang benar.
5. **Job utama lewat UI** (vLLM 4B uji dimatikan dulu): `maxTrainRows=10000`, 1 epoch (±1.250 langkah, ±3 jam), `maxEvalRows=300`.
   Bila hasilnya naik jelas dan waktu tersedia, ulangi dengan 20.000 baris (±6 jam, bisa semalaman).
6. **Eval** lewat Evals → Vision di :3010 (adapter disajikan di `vllm4b-tl`, cara di `DEMO-VLM.md`): `latex-ocr-test` dan
   `chartqa-test`, dibandingkan dengan `tl-3ep` (16,0% / CER 0,198 / ChartQA 62,7%) dan base (0,7% / 0,417 / 57,7%).

### Gerbang selesai
- **F3b selesai:** satu job vision dari dataset HF dijalankan dari tombol Hub sampai `COMPLETE`.
- **Q membaik bila:** exact match ≥ 20% (lebih dari 2 galat di atas 16,0%) **dan** CER < 0,198, dengan ChartQA tidak turun
  di bawah 57,7% − 2 galat (±52%). Kalau tidak tercapai, laporkan apa adanya; jangan menambah epoch untuk mengejar angka
  (3 epoch sudah menunjukkan menghafal).
- Perbarui `DEMO-VLM.md` dan `UJI-END-TO-END.md` dengan angka baru, dan adapter demo di `vllm4b-tl`.

### Risiko
- Dekode gambar HF di dalam loop bisa lebih lambat dari ZIP **[verifikasi dari log tok/s langkah pertama]**.
- Unduhan dataset di job TL memakai jaringan box; 373 MB, sekali per job (cache HF di volume TL) **[verifikasi cache dipakai ulang]**.

---

## Paket A — VLM lokal untuk RantAI Agents (R, celah gateway di F2)

### Fakta hari ini (dibaca dari kode `RantAI-Agents` dan env kontainer `rantai-agents-app-1`, tanpa membaca kunci)
- **Deskripsi gambar di chat** (`src/lib/chat/file-processor.ts:213-262`): bila OCR hampir kosong, gambar dikirim ke
  **OpenRouter**, URL di-hardcode, model dari `OCR_FALLBACK_MODEL` (di UGM: `google/gemini-2.5-flash`). `OPENROUTER_API_KEY`
  terisi, jadi gambar pengguna **keluar ke cloud** hari ini.
- **Penyaring gambar KB** (`src/lib/rag/figure-gate.ts`): aktif di UGM (`KB_FIGURE_VLM_ENABLED=1`), memanggil
  `KB_FIGURE_VLM_BASE=https://api.minimax.io/v1` dengan `MiniMax-M3`, `topN=2`, timeout 8 detik, di jalur jawaban. Kode ini
  sudah dirancang untuk endpoint on-prem OpenAI-compatible (`apiKey` opsional), jadi **bisa dialihkan lewat konfigurasi saja**.
- RAG ingest memakai `openai/gpt-4o-mini` (`src/lib/rag/file-processor.ts:11`) **[verifikasi apakah aktif di UGM]**.
- Ada harness benchmark di `tests/bench-kb/src/ikat/`, termasuk provider lokal OpenAI-compatible (`IKAT_PROVIDER=ollama`,
  `IKAT_OLLAMA_BASE`), dan validasi juri gambar terhadap 48 item anotasi manusia (`judge-figures.ts`).
- Gateway LLMOps menerima body sampai 32 MB (`docker/backend/gateway.py:48-49`), cukup untuk gambar base64. Uji gambar
  lewat gateway ber-API-key secara live **belum pernah dilakukan**.

### Langkah (tahap 1: ukur, tanpa mengubah produksi)
1. **Uji gateway dengan gambar (menutup celah F2).** Buat API key uji di Serve → Gateway keys, kirim satu permintaan
   bergambar ke gateway yang melayani vLLM 8B **[verifikasi: `rantai-gateway-vllm` atau `rantai-gateway-8b`, dan yang mana
   dipakai RantAI Agents]**. Catat status, latensi, dan jawaban. Hapus key uji setelahnya. Tambahkan kasus ini ke
   `scripts/e2e.js` (blok Vision) supaya terulang.
2. **Penyaring gambar KB: A/B offline.** Cari skrip di `tests/bench-kb` yang menghasilkan angka di komentar
   `figure-gate.ts` (presisi, F1, "top 2 untuk 87% tautan") **[verifikasi: README bench-kb]**. Jalankan dengan prompt yang sama
   persis, model lokal SEA-LION 8B VL (`http://vllm8b:8000/v1`, dari kontainer uji di jaringan `rantai-llmops_llmops`),
   dibandingkan dengan angka MiniMax-M3 yang tercatat. Ukur juga latensi per panggilan (batas produksi 8 detik). Jalankan
   di kontainer uji, bukan di `rantai-agents-app-1`. Jangan memanggil MiniMax atau OpenRouter dari uji ini (memakai kunci
   produksi); pakai angka yang sudah tercatat.
3. **Deskripsi gambar chat: perbandingan kecil.** 30 gambar dari korpus KB (gambar tanpa teks) dan 20 dari ChartQA:
   deskripsi dari SEA-LION 8B VL dengan prompt `describeImage` yang sama persis. Tidak ada metrik otomatis yang jujur untuk
   deskripsi bebas, jadi hasilnya berupa tabel berdampingan untuk dinilai manusia, ditambah CER untuk gambar yang mengandung
   teks (kunci dari korpus).
4. **Laporan keputusan** (`docs/VLM-UNTUK-RANTAI-AGENTS.md`): angka tahap 2 dan 3, latensi, dan rekomendasi per pemakaian:
   alihkan, jangan, atau alihkan dengan syarat. Ditulis untuk pemilik RantAI Agents dan Pak Risman.

### Tahap 2 (hanya setelah disetujui pemilik RantAI Agents dan pengguna)
- **Penyaring KB:** ganti tiga env (`KB_FIGURE_VLM_BASE` ke gateway LLMOps, `KB_FIGURE_VLM_MODEL=base`,
  `KB_FIGURE_VLM_API_KEY` ke key gateway). Butuh restart `rantai-agents-app-1` (ada downtime); rollback = kembalikan env.
- **Deskripsi chat:** PR kecil ke repo RantAI Agents: `OCR_FALLBACK_BASE_URL` dan `OCR_FALLBACK_API_KEY`, default tetap
  OpenRouter supaya kompatibel. Build dan rilis image RantAI Agents mengikuti alur tim itu, bukan alur LLMOps.

### Gerbang selesai
- Tahap 1: gateway terbukti menerima gambar; laporan keputusan berisi angka, bukan kesan.
- R selesai bila satu pemakaian berjalan di produksi lewat LLMOps dengan kualitas setara dalam galat dan latensi dalam batas.

### Risiko
- SEA-LION 8B VL kemungkinan di bawah Gemini 2.5 Flash untuk deskripsi bebas. Itu yang diukur, bukan diasumsikan.
- Beban tambahan di vLLM 8B produksi: penyaring KB memanggil sampai 2 gambar per jawaban. Ukur di tahap 2 dengan panel
  Engine load sebelum menyalakan untuk semua pengguna.

---

## Paket C — Adapter VL di SGLang (G8)

### Fakta hari ini
- SGLang v0.5.23 (yang dipakai box) mendukung LoRA di Gemma-3 VL, **hanya lapisan bahasa**: `gemma3_mm.py` punya
  `supports_lora = True` dengan pola `^language_model\.model\.layers\.(\d+)\.(?:self_attn|mlp)\.(?:qkv_proj|o_proj|down_proj|gate_up_proj)`
  (ada sejak Maret 2025, termasuk di tag v0.5.20–v0.5.23). Qwen3-VL juga punya pola LoRA.
- Adapter kita (`tl-3ep`) hanya di bahasa (0 kunci vision), jadi lolos penolakan vision yang kita buat.
- Nama kunci adapter kita `base_model.model.model.language_model.layers.N...` (Transformers 5), sedangkan pola SGLang memakai
  `language_model.model.layers.N...`. **[verifikasi: apakah loader LoRA SGLang menormalkan nama ini; kalau tidak, helper
  `prepare` di `src/lib/serve-sglang-container.ts` perlu memetakan nama kunci.]**

### Langkah
1. Kontainer uji `sglang4b-test` dari image `lmsysorg/sglang:v0.5.23-cu130` dengan `SGLANG_ENTRYPOINT` kita, base Gemma-SEA-LION
   4B VL (path snapshot lokal), `SGLANG_LORA_MODULES=tl3ep=<folder adapter>`, fraksi memori setara ±13 GB **[verifikasi
   angka `--mem-fraction-static` untuk 4B di GB10]**. Hentikan `vllm4b-tl` dulu.
2. `rantai-frontend-vlm` (:3010) dibuat ulang dengan `SGLANG_BASE_URL=http://sglang4b-test:30000/v1`.
3. Evals → Vision: `latex-ocr-test` untuk `base` dan `tl3ep` lewat SGLang.
4. Bila nama kunci tidak cocok: perbaiki di helper `prepare`, tambah tes Python yang menjalankan helper (pola tes di
   `serve-sglang-container.test.ts` sudah ada), ulangi.

### Gerbang selesai
Skor `tl3ep` lewat SGLang dalam ±2 poin exact match dan ±0,02 CER dari skor yang sama lewat vLLM. Catat throughput
dibanding vLLM pada konkurensi 2 (seperti eval kita).

---

## Paket D — Evaluasi GGUF VL dan export dari UI (F7)

### Fakta hari ini
- Export VL lewat skrip terbukti (llama.cpp b12182): `q8_0` 4,1 GB + `mmproj` 0,85 GB menjawab satu gambar di CPU dan GPU.
- Binari llama.cpp butuh glibc ≥ 2.38; image vLLM (Ubuntu 22.04) tidak cukup, image SGLang (24.04) cukup.
- `llama-mtmd-cli` menggantung tanpa keluaran di `exec` dengan TTY; jalankan di latar belakang atau dengan `< /dev/null`.
- Export dari UI lewat `src/lib/host-runner.ts` (`EXPORT_SIDECAR_URL`) dan pemetaan baris log di `src/lib/finetune.ts:1091`.
  Cabang VL di skrip tidak menjalankan `ollama create`, dan UI belum tahu cara menampilkan dua berkas hasilnya.
  **[verifikasi: di mana sidecar export berjalan, dan apakah ia punya git, jaringan, dan Python dengan peft.]**

### Langkah
1. **Kualitas GGUF:** `llama-server` (build CUDA b12182, `-ngl 99`, `--mmproj`) di kontainer uji dari image SGLang, alias
   `llama4b-test`. Buat varian `Q4_K_M` dengan `llama-quantize` dari rilis yang sama. :3010 diarahkan ke server itu sebagai
   engine OpenAI-compatible **[verifikasi: `/v1/models` llama-server dikenali pemeriksa model di route eval]**. Eval 300 soal
   LaTeX dan ChartQA untuk `q8_0` dan `Q4_K_M`.
2. **CPU:** 50 soal LaTeX dengan build CPU (16 thread): tok/s prompt dan generasi, RAM puncak. Ini data pertama untuk CPU/Edge E3.
3. **UI export:** pemetaan baris log VL (`OK: language GGUF`, `OK: vision projector`) menjadi tahap yang jelas; halaman hasil
   menampilkan dua path dan perintah `llama-server`; sidecar disiapkan agar punya yang dibutuhkan. Satu export VL dari UI.
4. Flip `export.ggufVision` ke `live` hanya bila langkah 1 dan 3 lulus.

### Gerbang selesai
`q8_0` dalam ±2 poin dari vLLM bf16 di kedua set; selisih `Q4_K_M` dilaporkan apa adanya; satu export VL dari UI berhasil.

---

## Paket E — Benchmark VL standar (F6.2)

### Langkah
1. **[verifikasi]** versi `lmms-eval` yang mendukung model OpenAI-compatible (nama model di lmms-eval, misalnya
   `openai_compatible`) dan task yang tersedia: `chartqa`, `docvqa_val`, `textvqa_val`, `ocrbench`, `mmmu_val`.
2. Kontainer uji (jaringan untuk unduhan dataset HF, cache ke volume `vlm-work`) menembak `vllm4b-tl`, untuk `base` dan adapter
   demo terbaru, `--limit 300` per task.
3. Hasil ke `UJI-END-TO-END.md`: tabel per task, base vs adapter, dengan galat.

### Gerbang selesai
Tidak ada task yang turun di luar galat setelah fine-tune. Kalau ada yang turun, itu temuan yang dilaporkan, bukan disembunyikan.
Lisensi beberapa dataset benchmark (misalnya GPL) hanya untuk eval internal, jangan didistribusikan di produk.

---

## Yang tidak dikerjakan sekarang
- **G9 gateway SGLang di box:** layanan ada di compose; membuatnya mudah, tapi tanpa pemakai tidak ada yang diuji.
- **G10 migrasi RantAI Agents ke SGLang:** keputusan 2 Nov menunda. Data yang bisa memicu peninjauan ulang: SGLang 64,5 vs
  vLLM 43,3 tok/s pada 8 permintaan paralel (catatan roadmap).
- **Fine-tune 8B VL:** tetap tidak muat di memori box (4B saja ±17 GiB).

## Keputusan yang dibutuhkan dari pengguna
1. Setuju mulai paket B dan tahap 1 paket A bersamaan?
2. Paket B: 10.000 baris (±3 jam) dulu, atau langsung 20.000 (±6 jam, semalaman)?
3. Paket A: siapa pemilik RantAI Agents yang menyetujui tahap 2, dan boleh membuka PR ke repo RantAI Agents?
4. Izin push trainer ke `main` saat paket B langkah 4 (tanpa rilis baru), dan rilis v0.45.0 setelah paket B dan C selesai?

## Template prompt untuk Sonnet (satu paket per sesi)

```
Kerjakan Paket <X> di docs/RENCANA-VLM-LANJUTAN.md dari awal sampai gerbang selesainya.
Ikuti "Aturan untuk eksekutor". Mulai dengan semua butir [verifikasi] di paket itu dan laporkan hasilnya sebelum menulis kode.
Box: Portainer https://10.17.254.27:9443 (minta password ke pengguna; sertifikat dipin, sidik jari SHA-256 55:66:50:EE…6B).
Produksi tidak diubah. Commit hanya bila diminta, tanpa baris atribusi Claude.
Di akhir: angka vs pembanding, apa yang gagal, apa yang belum, dan perubahan di box (kontainer yang masih jalan).
```
