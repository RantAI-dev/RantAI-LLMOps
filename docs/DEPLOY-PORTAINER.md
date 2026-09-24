# Memasang RantAI-LLMOps lewat Portainer

Panduan ini menggambarkan susunan yang benar-benar berjalan di kotak UGM per
**25 September 2026**, bukan rancangan awalnya. Bagian "Jebakan" di akhir berisi
hal-hal yang sudah pernah memakan waktu berjam-jam; bacalah sebelum menyentuh
apa pun di server yang sedang dipakai.

## Yang berjalan di sana

Delapan layanan, bukan tiga seperti versi pertama dokumen ini.

```
  frontend             :3000    satu-satunya pintu untuk pengguna
    │ INFERENCE_BASE_URL → rantai-backend:8339
    │ OLLAMA_BASE_URL    → ollama:11434
    │ VLLM_BASE_URL      → vllm4b:8000
    ▼
  rantai-backend       :8339    orkestrasi pekerjaan, mesin berkas, sidecar GPU
  ollama               (tanpa port host — sengaja)
  vllm / vllm4b        (tanpa port host — sengaja)
  rantai-gateway       :11435 → ollama          klien luar, wajib kunci
  rantai-gateway-vllm  :11436 → vllm4b          klien luar, wajib kunci
```

Ollama **tidak** dipublikasikan ke jaringan: ia tanpa autentikasi dan melayani
setiap model yang pernah ditarik. Klien luar — RantAI Agents, misalnya — masuk
lewat gerbang, yang memaksa kunci API dan daftar-izin model.

> **`vllm4b` tidak ikut naik secara otomatis.** Layanan itu berada di balik
> `profiles: ["vllm4b"]`, jadi `docker compose up` biasa melewatinya. Di kotak
> UGM ia dijalankan terpisah dari tumpukan, dan begitu pula
> `rantai-gateway-vllm` — keduanya tidak punya label compose. Menaikkan ulang
> tumpukan tidak akan menyentuh keduanya.

---

## Prasyarat

- **Portainer** mengelola host Docker.
- **NVIDIA Container Toolkit** agar kontainer melihat GPU.
- **Kontainer istimewa diizinkan** — kotak pasir penyedia komputasi (bwrap)
  memerlukannya.
- **Ruang kosong ≥ 60 GB.** Citra backend ~5 GB, dan volumenya tumbuh menjadi
  ~15–20 GB setelah pemasangan pertama. Penggabungan adapter menambah lagi:
  satu model 4B menjadi **8,1 GB** per adapter.

---

## 1. Membangun citra

Terbitkan **GitHub Release**; alur kerja `ghcr.yml` membangun keduanya
(amd64 + arm64) ke GHCR. Alur itu dipicu **hanya oleh rilis** — sebuah push
biasa tidak membangun apa pun.

- `ghcr.io/rantai-dev/rantai-llmops-fe`
- `ghcr.io/rantai-dev/rantai-llmops-backend`

---

## 2. Menaikkan tumpukan

Portainer → **Stacks → Add stack → Web editor**, tempel
[`docker-compose.portainer.yml`](../docker-compose.portainer.yml). Isi variabel
lingkungan berikut:

| Variabel | Nilai |
|---|---|
| `TRANSFORMERLAB_JWT_SECRET` | `openssl rand -hex 32` |
| `TRANSFORMERLAB_REFRESH_SECRET` | `openssl rand -hex 32` (berbeda dari di atas) |
| `APP_PASSWORD` | kata sandi antarmuka web |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `INFERENCE_MODEL` | model obrolan bawaan — **harus ada di Ollama** |
| `GATEWAY_API_KEYS` | kunci untuk gerbang Ollama (11435) |
| `GATEWAY_VLLM_API_KEYS` | kunci untuk gerbang vLLM (11436) |
| `GATEWAY_VLLM_ALLOWED_MODELS` | daftar-izin, mis. `base,askv6,learn,practice` |
| `HF_TOKEN` | opsional, untuk model bergerbang |
| `INFERENCE_API_KEY` | kosongkan dulu — diisi pada langkah 4 |

> **Rahasia JWT wajib.** Tanpa keduanya backend menjawab `/` tetapi setiap
> masuk berbalas 500.

Backend menghabiskan **30–40 menit pada penyalaan pertama** untuk memasang
dirinya. Ia siap ketika lognya menulis `Uvicorn running on http://0.0.0.0:8339`.

---

## 3. Menarik model obrolan bawaan

Portainer → kontainer `ollama` → **Console**:

```sh
ollama pull qwen2.5:3b-instruct
```

Nama ini **harus sama persis** dengan `INFERENCE_MODEL`. Kalau tidak,
aplikasi menebak model mana yang dipakai, dan tebakannya bisa jatuh pada model
penyematan yang menolak obrolan.

---

## 4. Menyiapkan autentikasi backend (sekali saja)

Backend yang baru punya admin tetapi **belum punya kunci API**. Portainer →
kontainer `rantai-backend` → **Console** (`/bin/bash`):

```bash
TL=http://localhost:8339
TOKEN=$(curl -s -X POST "$TL/auth/jwt/login" \
  -d "username=admin@example.com" -d "password=admin123" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
TEAM=$(curl -s "$TL/users/me/teams" -H "Authorization: Bearer $TOKEN" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
curl -s -X POST "$TL/auth/api-keys" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "{\"name\":\"rantai-llmops\",\"team_id\":\"$TEAM\"}"
H=(-H "Authorization: Bearer <tempel api_key dari atas>" -H "X-Team-Id: $TEAM")
curl -s "${H[@]}" "$TL/experiment/create?name=rantai-ft"
curl -s "${H[@]}" "$TL/experiment/create?name=rantai-eval"
```

Otomatisasinya ada di
[`scripts/bootstrap-tl-auth.sh`](../scripts/bootstrap-tl-auth.sh).

## 5. Memasang kunci ke antarmuka

Isi `INFERENCE_API_KEY` dengan kunci dari langkah 4, lalu naikkan ulang.

## 6. Selesai

Buka `http://<host>:3000`.

---

# Jebakan

Setiap butir di bawah ini pernah benar-benar terjadi.

## Backend dipaku pada digest — jangan naikkan tanpa rencana

Berkas compose memaku backend pada `@sha256:d4c323…`, bukan `:latest`. Ini
disengaja.

Pada **21 Juli 2026** backend naik versi, versi barunya membawa skema basis data
baru, `INFERENCE_API_KEY` yang lama menjadi tidak sah, dan **setiap daftar
berbalik nol**. Selama berjam-jam itu terbaca sebagai kehilangan data permanen,
padahal berkasnya tidak pernah berpindah.

Menaikkan backend **boleh**, tetapi urutannya: naikkan → jalankan ulang langkah
4 → simpan kunci baru → naikkan ulang. Yang tidak boleh adalah membuat ulang
kontainernya dari `:latest` tanpa langkah itu.

## Memperbarui hanya antarmuka

Cara yang dipakai sehari-hari, karena tidak menyentuh backend:

1. Tarik `ghcr.io/rantai-dev/rantai-llmops-fe:latest`
2. Salin **seluruh** konfigurasi kontainer yang sedang berjalan (env, port,
   volume, jaringan, **dan label `com.docker.compose.*`** — tanpa label itu
   tumpukan kehilangan jejak kontainernya)
3. Ganti nama yang lama, hentikan, buat yang baru dengan citra baru, jalankan
4. Hapus yang lama setelah yakin

Panggilan yang mengubah keadaan di Portainer ditolak dua kali: sekali karena
tidak ada `Referer`, sekali lagi karena tidak ada token CSRF. Tokennya datang
pada balasan GET mana pun sebagai tajuk `x-csrf-token`.

## Daftar-izin gerbang yang kosong berarti IZINKAN SEMUA

Kebalikan dari kunci API, yang kosong berarti tolak semua.

```
GATEWAY_API_KEYS        kosong → tolak semua   (gagal-tertutup)
GATEWAY_ALLOWED_MODELS  kosong → IZINKAN SEMUA (gagal-terbuka)
```

Kalau `GATEWAY_VLLM_ALLOWED_MODELS` terhapus saat menaikkan ulang, adapter
`grading` — yang sengaja ditutup — ikut terbuka untuk klien luar.

## Dua gerbang, dua kumpulan kunci

| Gerbang | Port | Ke | Kuncinya dari |
|---|---|---|---|
| `rantai-gateway` | 11435 | Ollama | `GATEWAY_API_KEYS` |
| `rantai-gateway-vllm` | 11436 | vllm4b | `GATEWAY_VLLM_API_KEYS` |

Halaman **Deployments** hanya mengelola yang 11435. Kunci untuk 11436 diatur
lewat variabel lingkungan dan tidak pernah tampil di antarmuka. Kunci yang satu
tidak berlaku di gerbang yang lain.

## GPU bisa lepas dari kontainer yang sedang berjalan

Terjadi **dua kali pada 24 September**. Gejalanya:

- Halaman Compute menampilkan nol GPU
- `nvidia-smi` di dalam kontainer: `Failed to initialize NVML`
- `/dev/nvidia*` tetap ada dan izinnya `rw`, tetapi membukanya ditolak
- Proses yang **sudah** memegang GPU (vLLM) terus melayani
- Setiap pekerjaan **baru** mati dengan `No CUDA GPUs are available`

Yang terjadi: pengendali cgroup mencabut akses perangkat dari kontainer yang
sedang hidup. **Obatnya: jalankan ulang kontainer itu.** Pemicunya belum
teridentifikasi — untuk itu perlu log host (`journalctl -u docker`), bukan
Portainer.

Kalau pekerjaan GPU tiba-tiba selalu gagal, periksa `nvidia-smi` **di dalam**
kontainer sebelum mencurigai aplikasinya.

## Menggabungkan adapter 4B memakan 8 GB dan lebih dari 20 menit

Evaluasi pada hasil penyetelan mengharuskan adapter digabung ke model dasar
lebih dulu, dan hasilnya disimpan di `~/.transformerlab/rantai_merged/`.

| Model | Hasil gabungan |
|---|---|
| 0.5B | 958 MB |
| **4B** | **8,1 GB** |

Percobaan **pertama** pada adapter 4B baru akan gagal: penggabungan berlangsung
lebih lama daripada batas sabar sidecar, sehingga antarmuka melaporkan galat
walaupun prosesnya terus berjalan di latar. Percobaan **kedua** berhasil, karena
hasilnya sudah tersimpan.

Folder itu **tidak dibersihkan sendiri**.

## Berkas compose bukan satu-satunya kebenaran

`vllm4b` dan `rantai-gateway-vllm` berjalan **di luar tumpukan** dan tidak punya
label compose. Menaikkan ulang tumpukan tidak menyentuh keduanya — baik itu
menguntungkan (konfigurasi vLLM tidak terhapus) maupun merepotkan (perubahan
pada berkas compose tidak sampai ke sana).

---

## Catatan lain

- **Penyimpanan:** semuanya di volume bernama `tl_data`, `ui_data`,
  `ollama_data`. Selamat dari penaikan ulang.
- **Ekspor GGUF di dalam aplikasi** memerlukan soket Docker (bind mount, mati
  secara bawaan).
- **ARM64 / GB10:** citra backend dibangun untuk arm64; pemasangan pertama
  memilih roda cu130 sendiri.
