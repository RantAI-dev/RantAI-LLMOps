# Laporan Uji End-to-End — RantAI LLMOps

**Tanggal:** 24 September 2026
**Sasaran:** `rantai-frontend` di server UGM (10.17.254.27:3000), image release v0.40.67
**Hasil:** API **45/46**, alur tulis **22/24**, peramban **8/8** — 3 bug ditemukan dan diperbaiki

---

## 1. Ringkasan

| Area | Lolos | Catatan |
|---|---|---|
| Autentikasi | 4/4 | termasuk penolakan password salah & route tergerbang |
| Tasks | 3/3 | 123 job nyata terbaca |
| Datasets | 4/4 | 5 dataset, preview 5 baris |
| Model Registry | 1/1 | katalog terjangkau |
| Deployments | 7/7 | dua engine hidup, 4 adapter, key tidak bocor |
| Prompt Registry | 1/1 | |
| Traces | 1/1 | |
| Evals | 2/2 | |
| Fine-tune | 2/2 | |
| Compute | 1/1 | metrik GPU |
| Chat | 3/4 | **1 gagal** |
| Render halaman | 16/16 | semua balas 200 |

---

## 2. Bug yang ditemukan

### Model bawaan chat tidak ada di Ollama

**Tingkat:** sedang — mengenai pengguna baru, bukan kehilangan data

Variabel `INFERENCE_MODEL` pada container frontend berisi `qwen2.5:0.5b`.
Model itu **tidak terpasang** di Ollama. Ollama punya 17 model, di antaranya
`qwen2.5:3b-instruct`, tetapi bukan versi 0.5b.

**Gejala:**

```
POST /api/chat  {"messages":[...]}          → 404
{"error":"model 'qwen2.5:0.5b' not found"}
```

Panggilan yang menyebut engine secara eksplisit tetap normal:

```
POST /api/chat  {"messages":[...], "engine":"vllm", "model":"askv6"}  → 200
```

**Dampak:** pengguna yang membuka halaman Interact tanpa memilih model akan
melihat galat, padahal sistemnya sehat.

**Perbaikan:** setel `INFERENCE_MODEL=qwen2.5:3b-instruct` pada container
frontend, atau tarik model `qwen2.5:0.5b` ke Ollama. Keduanya menuntut
container frontend dibuat ulang.

**Status:** belum diperbaiki — menunggu keputusan.

---

## 3. Yang diuji

### Autentikasi

| Uji | Harapan | Hasil |
|---|---|---|
| Password salah | 401 | ✅ 401 |
| Badan permintaan rusak | 400 | ✅ 400 |
| Password benar | 200 + cookie sesi | ✅ |
| Route terlindungi tanpa cookie | 401 | ✅ 401 |

### Tasks

| Uji | Hasil |
|---|---|
| Daftar job | ✅ 123 job nyata |
| Log job | ✅ terbaca |
| **Tepi:** job tidak dikenal | ✅ ditangani, tidak error 500 |

### Datasets

| Uji | Hasil |
|---|---|
| Daftar dataset | ✅ 5 dataset |
| Pratinjau baris | ✅ 5 baris dari `grounded-smoke-t3` |
| **Tepi:** dataset tidak dikenal | ✅ ditangani |
| **Tepi:** parameter `id` hilang | ✅ 400 |

### Deployments

| Uji | Hasil |
|---|---|
| Probe engine | ✅ 2 engine, keduanya tersedia |
| Ollama terjangkau | ✅ |
| vLLM terjangkau | ✅ |
| Daftar adapter | ✅ `askv6, learn, practice, grading` |
| Adapter usang `ask` sudah hilang | ✅ tidak ada |
| Daftar key gateway | ✅ 1 key |
| **Keamanan:** key mentah tidak pernah dikirim | ✅ hanya `keyMasked` |

### Chat

| Uji | Hasil |
|---|---|
| Inferensi via vLLM | ✅ 200, aliran SSE normal |
| Model bawaan Ollama | ❌ **404** — lihat bagian 2 |
| **Tepi:** engine tidak dikenal | ✅ ditolak |
| **Tepi:** `messages` kosong | ✅ 400 |

### Render halaman

Keenam belas halaman balas 200: Dashboard, Tasks, Datasets, Model Registry,
Deployments, Interact, Fine-tune, Evals, Prompts, Traces, Compute, Hub, Notes,
Workflows, Generations, Settings.

---

## 4. Cara menjalankan ulang

Skrip uji ada di `scripts/e2e.js`. Ia harus dijalankan **dari dalam** container
frontend, karena beberapa endpoint hanya terjangkau lewat jaringan internal.

```bash
# 1. Salin skrip ke container
docker cp scripts/e2e.js rantai-frontend:/tmp/e2e.js

# 2. Jalankan
docker exec -e TEST_HOST=frontend rantai-frontend node /tmp/e2e.js
```

Keluarannya JSON: `[{area, name, ok, detail}, ...]`.

### Jebakan yang perlu diketahui

**Jangan pakai `127.0.0.1`.** Next.js mengikat diri ke alamat IP container,
bukan loopback. Pakai alias jaringan `frontend`, kalau tidak setiap permintaan
akan gagal dengan `fetch failed`.

**Bentuk respons tidak seragam.** `/api/tasks/list` mengembalikan `{jobs:[...]}`
dan `/api/datasets/list` mengembalikan `{datasets:[...]}` — bukan array telanjang
dan bukan `{data:[...]}`. Salah membaca bentuknya membuat uji melaporkan "0 item"
padahal datanya ada. Ini sempat terjadi pada putaran pertama pengujian ini.

**Chat butuh `engine` yang eksplisit** kalau ingin memanggil adapter vLLM.
Tanpa itu, permintaan jatuh ke engine bawaan (Ollama).

---

## 5. Uji alur tulis

Dijalankan dengan izin eksplisit untuk mengubah keadaan produksi. **22 dari 24
lolos.** Yang benar-benar dibuat lalu dibersihkan: prompt (CRUD penuh), dataset
JSONL, API key gateway, dan job fine-tune sungguhan di GPU.

Skripnya `scripts/e2e-write.js`.

## 6. Uji peramban

Tiga berkas, dijalankan dengan Playwright terhadap deployment nyata:

| Berkas | Isi |
|---|---|
| `tests/ui.spec.ts` | 8 tes — halaman merender, galat konsol diperiksa kosong |
| `tests/ui-interactions.spec.ts` | 12 tes — kontrol utama tiap menu diklik |
| `tests/ui-coverage.spec.ts` | 20 tes — halaman sisa, filter, sortir, hapus, kerangka aplikasi, dan penjaga regresi |
| `tests/api-surface.spec.ts` | 55 tes — seluruh 55 rute API: gerbang autentikasi, rute baca, validasi masukan, rute destruktif |
| `tests/data-integrity.spec.ts` | 8 tes — memeriksa ISI: baris dataset utuh, teks prompt persis, dua endpoint sepakat |
| `tests/resilience.spec.ts` | 4 tes — **mematikan container sungguhan**; opt-in, tidak ikut jalan secara default |

**103 dari 103 lolos** terhadap image v0.40.70, ditambah 4 uji ketahanan.

### Sapuan seluruh permukaan API

| Yang diperiksa | Isinya |
|---|---|
| Gerbang autentikasi | 31 rute dipanggil tanpa sesi — semuanya wajib 401 |
| Rute baca | 26 rute wajib 200 **dan** berbentuk JSON |
| Rute tulis | 9 rute wajib menolak badan kosong, dengan pesan yang menyebut kolomnya |
| Rute destruktif | hapus dataset/model dan ekspor dengan id palsu — tak boleh ada yang 500 |
| Alur penuh | Catatan: buat, baca, simpan, hapus. Prompt: buat, tambah versi, baca, hapus |
| Sesi | keluar benar-benar mematikan sesi |

> **Jangan percaya satu sudut saja.** Uji gerbang sempat melaporkan 28 rute
> terbuka tanpa login. Diperiksa ulang dengan `curl` langsung: semuanya 401.
> Penyebabnya `use.storageState` pada konfigurasi ikut terbawa ke konteks yang
> dibuat di dalam uji, sehingga pemanggil "anonim" diam-diam membawa kuki sesi.
> Sebuah temuan keamanan harus diverifikasi dari sudut kedua sebelum dipercaya.

### Penjaga regresi

Dua bug pernah lolos dari rangkaian uji ini, jadi keduanya sekarang dikunci:

| Penjaga | Alasan |
|---|---|
| Chat tanpa memilih model harus 200 | `INFERENCE_MODEL` pernah menyebut model yang tak pernah diunduh; pengguna yang mengirim pesan tanpa memilih apa pun menerima 404 |
| `learningRate: "abc"` harus 400 | nilai bukan angka dulu lolos sampai ke trainer dan mati di dalam `SFTConfig`, setelah GPU membangun venv |
| Pesan galat menyebut kolom yang salah | supaya galatnya tidak sama membingungkannya dengan yang digantikan |

> **Kenapa ini penting.** Bug pertama lolos dari 37 uji karena setiap uji selalu
> memilih model lebih dulu — justru jalur yang tidak rusak. Uji yang hanya
> melewati jalan bahagia tidak menemukan apa pun.

```bash
APP_PASSWORD=<password-server> BASE_URL=http://10.17.254.27:3000 npx playwright test
```

> **`APP_PASSWORD` di `.env.local` berbeda dari server.** Nilai dev sengaja
> tidak sama, jadi berikan password server di baris perintah. Salah password
> akan terbaca sebagai kegagalan login yang membingungkan.

> **Login dibatasi 10 percobaan per 5 menit per IP.** Karena itu `globalSetup`
> login sekali untuk seluruh suite dan menyimpan sesinya. Bila jendelanya sedang
> tertutup, ia menunggu sesuai `Retry-After` lalu mencoba lagi.

### Yang benar-benar diklik

| Fungsi | Cara diuji |
|---|---|
| Unggah dataset JSONL | dialog dibuka, berkas dipilih, Upload diklik, muncul di daftar |
| Tolak ekstensi salah | `.txt` ditolak beserta pesannya |
| Cari model Hugging Face | diketik di Hub; **Download tidak diklik** |
| Buat prompt | empat kolom diisi lalu Create |
| Buat kunci gateway | nama diisi lalu Create key |
| Catatan | buat, ketik isi, klik Save, muat ulang, hapus |
| Navigasi Datasets ke Hub | |

Ditambah, dari berkas ketiga: katalog dan pencarian Model Registry, daftar
penyedia dan meteran GPU Compute, tombol Refresh serta tiga penyaring dan
pemilih jumlah baris di Traces, penyaring dan pengurutan Datasets, unggah lalu
hapus sebuah dataset, penyaring dan pembuka detail pekerjaan di Tasks, serta
kerangka aplikasi: pengalih tema, pelipat bilah sisi, pencarian global, dan
halaman Settings.

Penjagaan yang diperiksa tetap terkunci sampai formulirnya sah: Start
fine-tune, Run evaluation, Run pipeline, dan Compare pada Generations. Serta dari berkas pertama: 16
halaman sidebar dengan galat konsol diperiksa kosong, job dan dataset nyata
tampil, kedua engine aktif, Interact menjawab tanpa memilih model, dan tidak ada
sisa kata "Transformer Lab".

> **Catatan menyimpan secara manual.** Tidak ada penyimpanan otomatis — tombolnya
> berbunyi "Save" selama ada perubahan dan baru berubah menjadi "Saved" setelah
> tersimpan, jadi tombol itu harus diklik.

## 7. Uji ketahanan

Dijalankan terpisah karena **mematikan layanan sungguhan**:

```bash
RESILIENCE=1 APP_PASSWORD=... PORTAINER_USER=... PORTAINER_PASSWORD=...   npx playwright test tests/resilience.spec.ts
```

Hanya `ollama` dan `rantai-backend` yang boleh disentuh — nama lain ditolak
oleh asersi. Tiap uji menyalakan kembali apa yang dimatikannya di `finally`,
dan `afterAll` memulihkan semuanya apa pun yang terjadi. vLLM tidak pernah
disentuh karena melayani RantAI Agents.

| Skenario | Yang dipastikan |
|---|---|
| Ollama mati | `serve/info` melaporkan tidak tersedia, obrolan gagal dengan pesan, halaman tetap terbaca |
| Ollama kembali | pulih sendiri, tanpa memuat ulang aplikasi |
| Backend mati | daftar **tidak** balas kosong; kerangka aplikasi tetap hidup |
| Backend kembali | riwayat pekerjaan kembali utuh |

> **Kenapa daftar kosong berbahaya.** "Tidak ada pekerjaan" dan "tidak bisa
> bertanya" terlihat sama persis di layar, dan hanya satu yang benar. Pada 21
> Juli autentikasi putus, semua daftar balik nol, dan itu terbaca sebagai
> kehilangan data permanen selama berjam-jam — padahal berkasnya tidak pernah
> berpindah.
>
> Perbaikannya sempat gagal sekali: rute sudah menjawab 502, tetapi **tiga
> lapisan di bawahnya** menelan kegagalan lebih dulu, sehingga tidak ada yang
> sampai ke rute. Ketahuan hanya karena ujinya dijalankan ulang **setelah**
> dipasang ke server.

---

## 8. Batasan pengujian ini

Yang **tidak** tercakup:

- **Mengunduh model dari Hub dan menjalankan benchmark sampai selesai** sengaja
  dilewati: yang pertama menarik beberapa gigabyte, yang kedua menahan GPU
  berjam-jam. Keduanya tetap diuji sampai titik pengiriman.
- **Tidak menguji multi-tenant.** Hanya satu sesi, satu pengguna.
- **Tidak menguji beban.** Satu permintaan pada satu waktu.
- **Tidak menguji eval sampai tuntas.** Hanya penolakan masukan yang salah;
  menjalankan benchmark penuh memakan GPU berjam-jam.

Ketiganya belum mendesak pada skala sekarang.

---

## 9. Uji VLM (6 November 2026)

**Sasaran:** frontend uji `rantai-frontend-vlm` (10.17.254.27:3010, image `rantai-llmops-fe:vlm-dev` dibangun di box dari
working tree, data di volume sendiri `vlm-ui-data`) + engine uji `vllm4b-test` (Gemma-SEA-LION v4 4B VL, adapter `latex-ocr`).
Frontend produksi (`rantai-frontend`, :3000), `rantai-vllm-8b` dan RantAI Agents **tidak disentuh**: tidak ada restart,
satu permintaan bergambar baca-saja ke SEA-LION 8B produksi dari container terpisah. Rencana: `docs/RENCANA-VLM.md`.

**Hasil:** unit **868 tes TS + 152 tes Python** hijau (Linux, Node 22); `scripts/e2e.js` area Vision **17/17**;
API chat/gambar **20/20**; gerbang dataset **11/13** (satu kegagalan = rute daftar yang salah tebak di skrip uji saya, diulang dengan rute benar: lulus; satu lagi = temuan 4); training, serving dan eval berjalan end-to-end.

### Ringkasan

| Area | Hasil | Bukti |
|---|---|---|
| Chat bergambar | 20/20 | SEA-LION VL menjawab gambar (data URL dan rujukan tersimpan); `file://`/`http://` → 400; ref hilang → 400; body 25 MB → 413; Ollama teks-saja + gambar → 400; 10 percakapan bergambar = 4 KB tanpa `data:` |
| Dataset bergambar | 11/13 | ZIP 2.000 baris/2.200 gambar masuk (11,5 menit), tata letak `<id>/{train.jsonl,eval.jsonl,images/}`; ZIP rusak ditolak server dan tidak meninggalkan dataset; traversal dan non-gambar ditolak; S3 fixture OK |
| Trainer vision | lulus | fixture 100 baris: 10 langkah; demo 2.000 baris × 1 epoch = **32 menit**, loss evaluasi **0,235**, puncak GPU 9,0 GiB, `MemAvailable` terendah 13,7 GiB; adapter 476 kunci LoRA, 0 kunci vision |
| Serving adapter | lulus | vLLM melayani `base` + `latex-ocr`; `--limit-mm-per-prompt` 2: 3 gambar → 400, 2 gambar → 200; SGLang menolak adapter vision dengan alasan (13 tes) |
| Eval bergambar | lulus | lihat tabel hasil |
| UI (Chromium headless) | lulus | tab Evals → Vision, kind Vision di Add dataset (review ZIP), ubin Fine-tune → Vision, tombol lampiran di Interact |

### Hasil eval (base 4B vs adapter `latex-ocr`, 300 baris uji yang tidak pernah dipakai training)

| Set uji | Metrik | Base | `latex-ocr` |
|---|---|---|---|
| `latex-ocr-test` (LaTeX_OCR, split test) | exact match | 0,7% (0–1,6%) | **15,0%** (11,0–19,0%) |
| | CER rata-rata | 0,417 | **0,224** |
| `chartqa-test` (retensi, relaxed ±5%) | akurasi | 57,7% (52,1–63,3%) | 59,3% (53,8–64,9%) |

Fine-tune menaikkan skor tugasnya jauh di luar galat dan tidak menurunkan kemampuan umum (ChartQA setara).
Dasar pembanding produksi (SEA-LION 8B VL, 30 soal LaTeX): exact 2/30, CER 0,19.

### Temuan

1. **Prompt ChartQA tanpa instruksi jawaban pendek menghasilkan 0%** untuk semua model (model menjawab kalimat).
   Bukan kegagalan model; `make_demo_dataset.py` kini menambahkan "Answer with a single number or a short phrase only."
2. **`SFTTrainer` menolak dataset map-style buatan sendiri** (`train_dataset must be a Dataset or IterableDataset`),
   ditemukan di run GPU pertama; diperbaiki dengan `Dataset.with_transform` (`vlm_data.as_hf_dataset`).
3. **Daftar percakapan TL menjadi `[]`** bila ada percakapan dengan `updatedAt` bukan string ISO (pengurutan gagal).
   Ditemukan dari data uji saya; dihapus, percakapan asli tidak terganggu. Bukan bug fitur ini.
4. **`DELETE /api/datasets/vision/<id>` hanya berlaku untuk unggahan yang belum selesai.** Dataset S3 yang sudah
   selesai tidak bisa dihapus dari UI/API; satu fixture uji (25 baris) tertinggal di `s3://buku-korpus/datasets-vlm-e2e/`.
   Menghapusnya dengan kredensial produksi di luar aplikasi sengaja tidak dilakukan.
5. Unggah dataset besar lambat (±0,3 dtk per gambar, 4 panggilan TL per gambar).

### Belum terverifikasi

- **Peluncuran job lewat Transformer Lab: terbukti (7 Nov 2026).** Job 10 langkah dikirim lewat `POST /api/finetune/submit`
  (method `vision`, Gemma-SEA-LION 4B VL, dataset `vlm-e2e-latex-train`) pada frontend v0.44.0 produksi: clone trainer
  dari GitHub, venv, dataset TL, training (loss 3,00 → 0,54), checkpoint, adapter 476 kunci LoRA / 0 di vision tower
  beserta processor dan tokenizer, dan job tercatat `kind: vision`. Memori host terendah 19,7 GiB, GPU puncak 9,0 GiB.
  Job pertama gagal di checkpoint pertama: TRL membuat model card dan mengimpor `trackio`, yang terpasang di venv TL
  tetapi tidak cocok dengan `huggingface_hub`. Diperbaiki di `vlm_train_utils.skip_trackio_model_card` (commit `222ddd6`).
  Peringatan `index.json` dari `lab.save_model` muncul di akhir (metadata registri TL); adapter tetap tersimpan.
  Prasyarat: kontainer `rantai-backend` harus bisa membaca GPU (kalau tidak, `/api/finetune/submit` menjawab 503).
- **Konversi GGUF/`mmproj`: terbukti (7 Nov 2026).** `rantai_export_gguf.sh` dijalankan di kontainer uji (tanpa GPU, jaringan bridge)
  pada adapter job TL penuh dengan llama.cpp **b12182** (kode sumber dari tag, binari CPU arm64 diverifikasi dengan digest rilis).
  Hasil: `vlm-tl-full.q8_0.gguf` (4,1 GB) dan `mmproj-vlm-tl-full.f16.gguf` (0,85 GB). Dijalankan dengan `llama-mtmd-cli` di CPU pada
  gambar rumus yang sama: jawaban `( 1 - \Pi ) \xi = 0 ,` (referensi `( 1 - \Pi ) \ \xi = 0 ,`); 285 token prompt dalam 32 detik
  (±9 token/detik), generasi ±24 token/detik, 16 thread. Catatan: binari llama.cpp butuh glibc ≥ 2.38 (Ubuntu 24.04); image vLLM
  (22.04) tidak cukup, jadi dijalankan dari image SGLang. Hanya satu gambar yang diuji (bukan evaluasi), jadi kualitas GGUF vs vLLM
  belum diukur. Di GPU (binari CUDA 13.5 arm64 b12182, `-ngl 99`, GB10) jawabannya sama: prompt 479 token/detik, generasi 54 token/detik.
  `llama-mtmd-cli` yang dijalankan di `exec` Docker dengan TTY menggantung tanpa keluaran sampai `timeout` (dua run); yang
  berhasil dijalankan di latar belakang atau dengan `< /dev/null`. Dugaan kuat: ia menunggu stdin, tapi tidak diuji khusus. Ollama tidak dipakai untuk VL (tidak bisa memuat proyektor terpisah). Berkas hasil ada di
  volume `vlm-work` (`/w/home/.transformerlab/rantai_merged/vlm-tl-full`, ±5 GB).
- **Benchmark standar lmms-eval** (Fase 6.2) tidak dikerjakan; retensi dicek dengan set ChartQA sendiri.
- **Batas multimodal di `rantai-vllm-8b` produksi: dinyalakan 7 Nov 2026.** Kontainer dibuat ulang dengan konfigurasi
  yang sama ditambah `--limit-mm-per-prompt '{"image":4}' --mm-processor-kwargs '{"max_pixels":1048576}'` (downtime 152 detik,
  produksi idle saat itu, model yang disajikan tetap `base, ask, learn, practice, practicev10e8b`). Terverifikasi: teks dan
  1 gambar dijawab, 4 gambar diterima, 5 gambar ditolak 400 ("At most 4 image(s)"). Kontainer lama tersimpan berhenti sebagai
  `rantai-vllm-8b-prev` (jalan mundur: hentikan `rantai-vllm-8b`, ganti namanya, ganti nama `-prev` kembali, start). Hapus
  `-prev` setelah beberapa hari aman. Compose stack tidak diubah, jadi flag ini hidup di kontainer, bukan di berkas compose.
- Alur lampir-lalu-kirim di Interact diklik di browser headless (7 Nov 2026): `base` dan adapter hasil job TL menjawab gambar
  rumus. Evals → Vision dijalankan dari UI untuk adapter `tl-full` (LaTeX 14,3% / CER 0,236; ChartQA 61,7%).
- Form Deploy (field batas gambar) dicek lewat tes komponen, bukan di browser.

### Cara menjalankan ulang

```
# frontend uji + engine uji (Portainer): start container vllm4b-test, rantai-frontend-vlm (:3010)
docker exec -e TEST_HOST=frontend-vlm -e APP_PASSWORD=... rantai-frontend-vlm node /tmp/e2e.js   # scripts/e2e.js
python scripts/vlm/make_demo_dataset.py --out ~/vlm-demo      # latex-ocr-train/test.zip, chartqa-test.zip
```

### Tambahan 7 Nov 2026: adapter hasil job TL penuh

Job `f0dfde75…` lewat TL (2.000 baris, 1 epoch, 250 langkah, 32,1 menit, GPU puncak 9,04 GiB): adapter 476 kunci LoRA, 0 di vision
tower. Disajikan vLLM 4B sebagai `tl-full`, dievaluasi dari UI Evals → Vision pada 300 soal held-out: LaTeX exact 0,7% → 14,3%,
CER 0,417 → 0,236; ChartQA 57,7% → 61,7%. Adapter job 10 langkah (`tl-smoke2`) hanya 0,3% / CER 0,837, lebih buruk dari base:
adapter sekecil itu belum belajar format, jadi jangan dipakai untuk menilai kualitas. e2e penuh pada frontend v0.44.0 produksi:
61 dari 64 lulus (Vision 17/17); tiga yang gagal cek lama (`askv6` sudah tidak disajikan, `ask` kini memang disajikan, engine
tidak dikenal jatuh ke Ollama) dan tidak terkait VLM. Naskah demo: `docs/DEMO-VLM.md`.

### Tambahan 8 Nov 2026: job TL 3 epoch (dijalankan tanpa pengawasan semalam)

Job `f30b0145…` (adaptor `vlm-latex-tl-3ep`, data sama, 3 epoch, 750 langkah) selesai `COMPLETE` dalam 103 menit tanpa error: GPU puncak
9,04 GiB, memori host tersedia tidak pernah di bawah ±14 GiB, produksi tidak terpengaruh (tanpa restart/OOM). Adapter 476 kunci LoRA,
0 di vision tower. Disajikan sebagai `tl-3ep` dan dievaluasi lewat API Evals → Vision pada 300 soal held-out: LaTeX exact 16,0% (CER
0,198; 1 epoch: 14,3% / 0,236; base 0,7% / 0,417), ChartQA 62,7% (1 epoch 61,7%; base 57,7%). Loss latih 0,07 vs loss eval 0,239
menandakan mulai menghafal; kenaikan exact match masih di dalam galat standar (±2 poin).

### Tambahan 8 Nov 2026 (siang): dataset Hugging Face langsung, 3.200 baris

Trainer sekarang punya `max_train_rows` dan `max_eval_rows` (commit `ceb7d98`), dan Hub mengenali dataset bergambar (`1956a4d`).
Job `67aa497a…` (`vlm-latex-hf3200`) dikirim lewat API frontend uji :3010 (image dibangun dari working tree): `unsloth/LaTeX_OCR`,
`maxTrainRows=3200`, `maxEvalRows=100`, 1 epoch. Log trainer: "3200 train rows, 100 eval rows (10% hold-out); source: Hugging Face
unsloth/LaTeX_OCR" dan "Row caps: train 3200 of 61817, eval 100 of 6869". 400 langkah, ±55 menit, memori host terendah 16,2 GiB,
eval loss 0,270 → 0,217. Hasil di 300 soal held-out: LaTeX exact **13,7%** (41/300), CER **0,246**; ChartQA **56,7%** (170/300).
Gerbang yang saya tetapkan (exact ≥ 20% dan CER < 0,198) **tidak tercapai**; `hf3200` setara adapter 1 epoch (`tl-full` 14,3% /
0,236) dan di bawah `tl-3ep` (16,0% / 0,198). Penyebab tidak diuji: yang berbeda dari `tl-3ep` adalah jumlah langkah (400 vs 750),
data (3.200 baris beragam, 1 epoch, vs 2.000 baris, 3 epoch) dan sumber (HF vs ZIP); tidak ada ablasi. Tombol Hub diklik di browser
:3010: kartu `linxy/LaTeX_OCR` menampilkan lencana "Images" dan tombol "Use in vision fine-tune", yang membuka
`/finetune?dataset=linxy%2FLaTeX_OCR&method=vision` dengan ubin Vision terpilih, base Gemma-SEA-LION 4B VL dan dataset terisi.
Yang tidak diuji: job yang dikirim dari form (job dikirim lewat API dengan body yang sama), dan kolom `answer`/`prompt` selain
`unsloth/LaTeX_OCR`.

### Tambahan 11 Nov 2026: adapter VL di SGLang (paket C)

Kontainer uji `sglang4b-test` (`lmsysorg/sglang:v0.5.23-cu130`, entrypoint `SGLANG_ENTRYPOINT` dari repo), base Gemma-SEA-LION
4B VL, adapter `tl3ep` (job `f30b0145…`, 0 kunci vision). Temuan:
- **Nama kunci adapter tidak masalah:** SGLang memuat adapter Transformers 5 apa adanya (`target_modules` terdeteksi, backend
  LoRA `csgmv`).
- **Bug di entrypoint kita:** SGLang mematikan multimodal untuk Gemma-3 (juga Llama-4) kecuali diberi `--enable-multimodal`,
  lalu menolak setiap gambar dengan 400 "Model only supports text input". Semua 600 permintaan eval pertama gagal karena ini.
  Perbaikan: entrypoint selalu memberi `--enable-multimodal`; untuk arsitektur teks flag itu tidak berpengaruh
  (`is_multimodal = enable_multimodal and <arsitektur multimodal>`), dan Qwen3-VL di SGLang produksi sudah multimodal secara default.
  Frontend produksi v0.44.0 belum memuat perbaikan ini.
- **`--mem-fraction-static` di GB10** dihitung terhadap seluruh memori bersama, termasuk yang dipakai vLLM dan SGLang produksi
  (±36,6%), jadi untuk 4B perlu ±0,46–0,48 walau tambahan nyatanya hanya ±13 GB. Memori host terendah 9,0 GiB (tanpa multimodal)
  dan 10,9 GiB (dengan multimodal).
- **Hasil 300 soal LaTeX, `temperature: 0`:** SGLang base 0,0% / CER 0,541, `tl3ep` 11,0% (33/300) / CER 0,281. Di vLLM: base 0,7% /
  0,417, `tl3ep` 16,0% / 0,198. Gerbang paket C (±2 poin, ±0,02 CER dari vLLM) **tidak tercapai**. Adapter jelas bekerja di SGLang
  (penurunan CER oleh adapter mirip: −0,26 di SGLang, −0,22 di vLLM), tapi base pun lebih buruk di SGLang, jadi selisihnya ada di
  engine (pra-proses gambar atau kernel atensi multimodal `triton_attn`), bukan di LoRA. Penyebab pastinya tidak diselidiki.

### Tambahan 12 Nov 2026: adapter 20.000 baris, backend fix4, export GGUF VL dari UI

- **Training:** job `42c41d75…` (`vlm-latex-hf20k`), `unsloth/LaTeX_OCR`, `maxTrainRows=20000`, 1 epoch, 2.500 langkah, 298,8 menit,
  GPU puncak 9,04 GiB, memori host tersedia ≥ 16 GiB, eval loss 0,270 (langkah 250) → 0,118 (akhir). Adapter 476 kunci, 0 vision.
- **Eval 300 soal (vLLM):** LaTeX exact **27,7%** (83/300), CER **0,124**; ChartQA **59,0%**. Gerbang paket B (≥ 20%, CER < 0,198,
  ChartQA ≥ ±52%) **tercapai**. Sebelumnya: `tl-3ep` 16,0% / 0,198 / 62,7%.
- **Backend:** `rantai-backend` diganti dari `rantai-llmops-backend:fix3` ke `:fix4` (fix3 + skrip export dari `main`, hash diverifikasi).
  Jeda 2,3 detik, API TL kembali dalam 20 detik, GPU terdeteksi, sidecar export menjawab. Kontainer lama: `rantai-backend-fix3` (berhenti).
- **Export dari UI:** tombol "Export GGUF + projector" di baris job vision (commit `c04c01c`), diklik di browser pada frontend uji :3010:
  merge → converter → konversi → "Saved" dengan dua berkas dan perintah `llama-server`, 161 detik.
- **Kualitas GGUF:** `llama-server` (llama.cpp b12182 CUDA, `-ngl 99`) dengan berkas hasil export UI: LaTeX **31,7%** (95/300), CER
  **0,121**; ChartQA **59,3%**. Setara dengan vLLM (selisih exact 4 poin ≈ 1,5 galat standar). Flag `export.ggufVision` → `live`.

### Tambahan 12 Nov 2026 (siang): K-quant, rilis v0.45.1, backend fix5

- **K-quant:** export menerima `q4_k_m` dan `q5_k_m`: konversi ke `f16`, lalu `llama-quantize`, yang dibangun sekali dari checkout
  llama.cpp di volume TL dengan cmake + ninja dari pip (backend Ubuntu 22.04 terlalu tua untuk binari rilis). Di box: build ±30 detik,
  export `Q4_K_M` dari UI 221 detik. Ukuran: `Q4_K_M` 2.375 MiB, `q8_0` 3.940 MiB, `mmproj` 812 MiB.
- **Kualitas `Q4_K_M` (300 soal, llama-server):** LaTeX 30,7% (92/300), CER 0,134. `q8_0`: 31,7% / 0,121; vLLM bf16: 27,7% / 0,124.
  Kuantisasi 4-bit tidak menurunkan skor LaTeX di luar galat; CER sedikit naik. (ChartQA yang semula tertulis 61,3 / 59,3 / 59,0%
  dihitung dengan scorer yang salah; lihat bagian berikut.)
- **Backend:** `rantai-llmops-backend:fix5` (fix3 + skrip dengan K-quant), cadangan `rantai-backend-fix4`.
- **Rilis v0.45.1** (tombol export VL) terpasang di produksi; e2e penuh 63/63. K-quant ikut rilis berikutnya.

### Tambahan 12 Nov 2026 (sore): benchmark VL standar (paket E) dan scorer ChartQA yang salah

**lmms-eval 0.7.4**, model `openai` (OpenAI-compatible) ke `vllm4b-tl`, 300 soal per task, kontainer `lmms-eval-run` di box.
Dataset benchmark diunduh publik dari Hugging Face (tidak ada yang gated) dan hanya untuk eval internal.

| Task (metrik) | base | `tl-3ep` (2.000 baris, 3 epoch) | `hf20k` (20.000 baris, 1 epoch) |
|---|---|---|---|
| ChartQA (relaxed) | 35,3% ± 2,8 | 24,7% ± 2,5 | 22,0% ± 2,4 |
| DocVQA val (ANLS) | 0,738 ± 0,023 | 0,611 ± 0,024 | 0,530 ± 0,024 |
| TextVQA val (exact) | 64,7% ± 2,6 | 47,4% ± 2,8 | 42,4% ± 2,8 |
| OCRBench (dari 300) | 22,9% | 1,5% | 0,6% |
| MMMU val (pilihan ganda) | 43,3% | 42,0% | 41,0% |

ChartQA base lebih rendah dari set kita (57,7%) karena prompt dan split lmms-eval berbeda; yang dibandingkan adalah selisih antar
model di benchmark yang sama.

**Temuan: gerbang paket E tidak lolos.** Empat dari lima task turun jauh di luar galat setelah fine-tune LaTeX_OCR; hanya MMMU
(jawaban satu huruf) yang bertahan. Penyebabnya format, bukan cuma pengetahuan: adapter menulis tiap karakter dipisah spasi seperti
referensi LaTeX_OCR (`"F r i e n d"`, `"C O P E N H A G E N"`, `"3 4 . 6 %"`), dan OCRBench menilai string sehingga hampir nol.
Data lebih banyak (`hf20k`) memperbaiki LaTeX tapi memperparah kebiasaan ini.

**Scorer ChartQA kita buta terhadap ini.** `parseNumber` di `src/lib/vlm-eval.ts` membuang semua spasi, jadi `"1 2"` terbaca 12 dan
`"3 4 . 6 %"` terbaca 34,6. Diperbaiki di commit 56b0c2d: spasi hanya diterima sebagai pemisah ribuan (`"6 536"`). Hitung ulang
jawaban yang tersimpan (300 soal `chartqa-test`, tanpa inferensi baru):

| Model | ChartQA lama | ChartQA dihitung ulang |
|---|---|---|
| base | 57,7% | 57,7% |
| `tl-full` | 61,7% | 24,7% |
| `tl-3ep` | 62,7% | 27,7% |
| `hf3200` | 56,7% | 12,0% |
| `hf20k` (vLLM) | 59,0% | 21,0% |
| `hf20k` GGUF `q8_0` | 59,3% | 22,7% |
| `hf20k` GGUF `Q4_K_M` | 61,3% | 20,7% |

Base tidak berubah sama sekali, adapter jatuh ke 21–28%, sejalan dengan lmms-eval. Semua klaim "ChartQA tidak turun" sebelumnya
salah. Riwayat run di UI masih menampilkan skor lama (laporan tersimpan saat run); run baru memakai scorer yang benar.

**Arti untuk produk:** adapter LaTeX_OCR adalah spesialis rumus. Untuk menjaga kemampuan umum, langkah berikutnya (belum
dikerjakan) adalah mencampur data tanya-jawab gambar umum ke training (misalnya 10–20% baris ChartQA/TextVQA train) atau menormalkan
referensi LaTeX agar tidak berspasi per token, lalu ulangi paket E sebagai gerbang.

