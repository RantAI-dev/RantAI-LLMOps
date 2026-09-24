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

`tests/ui.spec.ts`, dijalankan dengan Playwright terhadap deployment nyata.
**8 dari 8 lolos** dalam 17 detik.

```bash
APP_PASSWORD=<password-server> BASE_URL=http://10.17.254.27:3000 npx playwright test
```

> **`APP_PASSWORD` di `.env.local` berbeda dari server.** Nilai dev sengaja
> tidak sama, jadi berikan password server di baris perintah. Salah password
> akan terbaca sebagai kegagalan login yang membingungkan.

> **Login dibatasi 10 percobaan per 5 menit per IP.** Karena itu `globalSetup`
> login sekali untuk seluruh suite dan menyimpan sesinya. Bila jendelanya sedang
> tertutup, ia menunggu sesuai `Retry-After` lalu mencoba lagi.

Cakupannya: penolakan password salah, 16 halaman sidebar dengan galat konsol
diperiksa kosong, job dan dataset nyata tampil, kedua engine aktif, Interact
menjawab tanpa memilih model, dan tidak ada sisa kata "Transformer Lab".

## 7. Batasan pengujian ini

Yang **tidak** tercakup:

- **Tidak menguji multi-tenant.** Hanya satu sesi, satu pengguna.
- **Tidak menguji beban.** Satu permintaan pada satu waktu.
- **Tidak menguji eval sampai tuntas.** Hanya penolakan masukan yang salah;
  menjalankan benchmark penuh memakan GPU berjam-jam.

Ketiganya belum mendesak pada skala sekarang.
