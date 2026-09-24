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
