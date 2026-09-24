# Arsitektur RantAI-LLMOps

Dokumen ini menjelaskan bagaimana RantAI-LLMOps disusun: frontend, backend, trainer,
dan alur job — beserta catatan keputusan teknis yang penting diketahui sebelum
mengubah apa pun.

Ditujukan untuk engineer yang akan meneruskan atau mengaudit sistem ini.

---

## Daftar Isi

1. [Gambaran umum](#1-gambaran-umum)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [Trainer](#4-trainer)
5. [Alur job training](#5-alur-job-training)
6. [Serving](#6-serving)
7. [Status fitur](#7-status-fitur)
8. [Keputusan teknis](#8-keputusan-teknis)
9. [Jebakan yang sudah pernah menggigit](#9-jebakan-yang-sudah-pernah-menggigit)

---

## 1. Gambaran umum

RantAI-LLMOps adalah antarmuka web untuk siklus hidup model bahasa: impor model dan
dataset, fine-tune, evaluasi, ekspor, lalu serving — semuanya di infrastruktur sendiri.

Sistemnya terdiri dari tiga lapis:

```
┌─────────────────────────────────────────────────────────┐
│  Frontend — Next.js 15 (App Router)                     │
│  UI + BFF. Tidak pernah memanggil GPU langsung.         │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP
┌────────────────────────┴────────────────────────────────┐
│  Backend — Transformer Lab (vendored, Python)           │
│  Job, dataset, model registry, compute provider.        │
└────────────────────────┬────────────────────────────────┘
                         │ meluncurkan job
┌────────────────────────┴────────────────────────────────┐
│  Trainer + Engine — Unsloth / TRL, vLLM / Ollama        │
│  Berjalan di GPU. Trainer di-clone per job dari repo.   │
└─────────────────────────────────────────────────────────┘
```

Prinsip yang dipegang: **frontend tidak pernah bicara langsung ke GPU.** Semua
orkestrasi lewat backend, sehingga mengganti engine atau memindahkan compute tidak
menyentuh UI.

---

## 2. Frontend

Next.js 15 dengan App Router. Berperan ganda sebagai UI dan sebagai BFF
(*backend for frontend*) — route di `src/app/api/*` meneruskan permintaan ke backend
sambil menyembunyikan kredensial dari browser.

### Struktur

```
src/
  app/
    (app)/          halaman aplikasi (butuh login)
    login/          halaman masuk
    api/            BFF — 20 route group
  modules/          17 modul fitur, satu folder per domain
  components/       komponen bersama + primitives UI
  lib/              klien backend, store, util, status fitur
  hooks/            hook lintas modul
```

### Modul

Satu folder per domain, masing-masing berisi `components/`, `hooks/`, `lib/`, dan
`index.ts` sebagai permukaan publiknya:

| Modul | Isi |
|---|---|
| `auth` | Login, sesi |
| `hub` | Impor model & dataset dari Hugging Face |
| `datasets` | Kelola dataset |
| `finetune` | Konfigurasi run, monitor training, bandingkan run |
| `evals` | Evaluasi dan riwayat skor |
| `model-registry` | Daftar model dan adapter |
| `serve` | Konfigurasi serving |
| `playground` | Chat langsung ke engine |
| `prompts` | Registry prompt |
| `traces` | Observabilitas permintaan |
| `tasks` | Daftar job |
| `compute` | Provider dan sumber daya |
| `workflows`, `generations`, `notes`, `settings`, `llm-ops` | Pendukung |

### BFF

Route di `src/app/api/` sengaja tipis: validasi masukan, panggil backend, bentuk
ulang respons. Logika domain tinggal di backend.

Konfigurasi koneksi ada di `src/lib/inference.ts` dan **hanya dibaca di server** —
variabelnya bukan `NEXT_PUBLIC`, jadi tidak pernah sampai ke browser:

| Variabel | Arti |
|---|---|
| `INFERENCE_BASE_URL` | Endpoint engine, kompatibel OpenAI |
| `INFERENCE_API_KEY` | Bearer token |
| `INFERENCE_TEAM_ID` | Header `X-Team-Id` untuk auth multi-tenant Transformer Lab |
| `INFERENCE_MODEL` | Nama model default |
| `INFERENCE_STREAM` | Matikan bila engine punya SSE yang rusak |

Karena BFF bicara ke **engine mana pun yang kompatibel OpenAI**, mengganti engine
cukup mengubah URL:

```
Ollama            → http://localhost:11434/v1
llama.cpp         → http://localhost:8080/v1
Transformer Lab   → http://localhost:8338/v1
vLLM              → http://vllm:8000/v1
```

---

## 3. Backend

Transformer Lab, **disalin apa adanya** ke `backend/` dan diperlakukan seperti
dependensi hulu.

| | |
|---|---|
| Sumber | `transformerlab/transformerlab-app` (folder `/api`) |
| Rilis | v0.40.0 (paket api 0.27.0) |
| Disalin | 15 Juni 2026 |
| Lisensi | AGPL-3.0 |
| Port | 8338 |

### Kenapa disalin, bukan dijadikan dependensi

Ini scaffolding sementara. Rencananya backend ini **akan ditulis ulang dalam Rust**,
jadi ia diperlakukan seperti pustaka pihak ketiga: **konfigurasi, jangan modifikasi.**
Semakin sedikit yang diubah, semakin mudah menyinkronkan ulang atau menggantinya.

Aturan praktisnya: kalau sebuah perilaku bisa diatur lewat parameter atau env,
lakukan itu. Mengedit `backend/` adalah pilihan terakhir.

### Yang disediakan backend

- Job: buat, jalankan, pantau, baca log
- Dataset dan model registry
- Compute provider — orkestrasi GPU lokal maupun remote
- Auth multi-tenant, dengan header `X-Team-Id`
- Permukaan inferensi kompatibel OpenAI di `/v1`

Catatan penomoran: rute orkestrasi ada di root (`/experiment`, `/model`, `/jobs`),
sedangkan `/v1` khusus permukaan inferensi. `TL_ROOT` di `inference.ts` adalah base
tanpa `/v1`, dipakai bersama oleh helper orkestrasi.

---

## 4. Trainer

Trainer **tidak ikut di dalam backend.** Ia hidup di repo ini pada
`trainers/unsloth-llm-train/`, dan Transformer Lab meng-clone-nya per job.

| Berkas | Isi |
|---|---|
| `task.yaml` | Kontrak job: repo, direktori, setup, run, parameter default |
| `train.py` | Skrip training: memuat model, memasang LoRA, menjalankan SFT |

### Kontrak job

```yaml
github_repo_url: https://github.com/RantAI-dev/RantAI-LLMOps
github_repo_dir: trainers/unsloth-llm-train
resources:
  accelerators: "NVIDIA:1"
setup: "uv pip install unsloth transformers torch datasets huggingface-hub wandb s3fs"
run: "python unsloth-llm-train/train.py"
```

Dua konsekuensi penting:

1. **Direktorinya harus sudah ada di branch default** sebelum job dijalankan, karena
   Transformer Lab meng-clone repo ini saat job mulai. Push saja sudah cukup — backend
   tidak perlu dibangun ulang.
2. **`s3fs` ada di setup** supaya `dataset` boleh berupa URI `s3://`. Korpus
   on-premise tidak perlu dipublikasikan ke Hugging Face Hub agar bisa dilatih.

### Fork, bukan salinan

`train.py` adalah fork dari trainer upstream, sengaja dijaga tetap mirip agar mudah
di-diff. Perbedaannya didaftar di docstring berkas itu sendiri. Dua yang paling
berpengaruh ke mutu:

- **Loss hanya dihitung pada giliran asisten.** Secara bawaan SFT menghitung loss pada
  seluruh urutan, termasuk konteks dan pertanyaan — model jadi diberi ganjaran karena
  mereproduksi kutipan, bukan karena menjawab.
- **Dataset gagal muat menghentikan training.** Upstream menyediakan dataset cadangan;
  perilaku itu membuat job selesai dan dilaporkan sukses padahal model dilatih dengan
  data yang salah.

Sisanya menyangkut kecocokan perangkat keras dan auditabilitas: kuantisasi 4-bit
dimatikan (GB10 punya 128 GB unified memory), optimizer lepas dari bitsandbytes, dan
jumlah sampel yang melebihi `max_seq_length` dicatat di log agar pemotongan tidak
terjadi diam-diam.

---

## 5. Alur job training

```
UI Fine-tune
   │  pilih model, dataset, hyperparameter
   ▼
BFF  /api/finetune
   │  validasi, susun parameter
   ▼
Backend  /compute_provider/providers/<id>/launch/
   │  buat job, alokasikan GPU
   ▼
Compute provider
   │  clone repo → jalankan setup → jalankan train.py
   ▼
train.py
   │  tarik dataset (lokal atau s3://)
   │  muat model dasar, pasang adapter LoRA
   │  latih; tulis log lewat lab.log
   ▼
Artefak adapter tersimpan di workspace job
```

### Memantau job

Trainer menulis log lewat `lab.log`, yang masuk ke **catatan job**, bukan stdout.
Untuk membacanya:

```
GET /experiment/<exp>/jobs/<id>/output
```

Kurva loss di UI diambil dari teks log itu: `src/modules/finetune/lib/parse-loss.ts`
memindai baris dict milik HF Trainer (`'loss': X` dan `'eval_loss': X`). Kurva baru
dirender setelah ada minimal dua titik.

> **Kalau kurva tidak muncul, curigai format lognya dulu.** Parser mencari bentuk
> `'loss': 0.83`. Log yang menulis `loss=0.83` tidak akan pernah cocok, dan gejalanya
> terlihat seperti fitur yang hilang padahal datanya yang beda bentuk.

### Menghitung jumlah langkah

Jumlah langkah bersifat deterministik:

```
langkah = ceil(jumlah_baris / (batch_size × gradient_accumulation_steps))
```

Jangan menebaknya dari persentase progres yang dibulatkan — itu pernah meleset jauh.

---

## 6. Serving

Adapter hasil training disajikan lewat vLLM, dengan beberapa adapter LoRA menempel
pada satu model dasar yang dimuat sekali.

```
Klien  ──►  Gateway (auth + allowlist)  ──►  vLLM  ──►  GPU
            API key wajib                     base + N adapter
```

### Gateway

`docker/backend/gateway.py` — proxy tipis di depan engine. Fungsinya dua:

1. **Auth.** Setiap permintaan wajib membawa `Authorization: Bearer <key>`.
   Perilakunya **gagal-tertutup**: daftar key kosong berarti menolak semua, bukan
   membuka semua.
2. **Allowlist model.** Nama model yang tidak terdaftar ditolak walaupun engine
   sebenarnya melayaninya.

Permukaannya sengaja sempit — hanya `/v1/chat/completions`, `/v1/completions`, dan
`/v1/embeddings` yang diteruskan. Rute administratif seperti menarik atau menghapus
model tidak pernah diteruskan, jadi memegang key tidak berarti bisa mengubah server.

Ada dua instans terpisah dengan daftar key masing-masing: satu di depan Ollama, satu
di depan vLLM.

### Adapter dipatri, bukan ditempel

Adapter yang dimuat saat berjalan **hilang begitu engine dimuat ulang**. Setelah
restart, permintaan ke adapter itu gagal — atau lebih buruk, diam-diam dilayani versi
lama. Karena itu setiap adapter dipatri di konfigurasi serving.

Nama yang dilayani adalah **peran, bukan versi**. Menaikkan versi cukup memindahkan
penunjuknya; kode klien tidak berubah.

---

## 7. Status fitur

`src/lib/feature-status.ts` mencatat hubungan tiap fitur UI dengan backend nyata.

| Status | Arti |
|---|---|
| `live` | Didukung endpoint backend sungguhan |
| `simplified` | Sebagian nyata; UI dipangkas agar sesuai kemampuan backend |
| `mock` | Belum ada dukungan backend — hanya untuk desain dan demo |
| `planned` | Backend mendukung, UI belum dibangun |

Per 24 September 2026: **semua entri `live`** — tidak ada lagi yang `mock`.
Enam kartu berisi angka nol yang dulu tersisa di dalam halaman sudah dihapus
pada tanggal yang sama.

> **Koreksi 24 September 2026.** Versi sebelumnya dokumen ini menulis "5 live,
> 11 mock" dan menyebut halaman Deployments, Model Registry, Dataset serta Tasks
> sebagai mock. **Itu salah.** Keempat halaman itu membaca endpoint sungguhan.
> Kesalahannya ada pada registry lama yang memberi satu label untuk satu halaman
> penuh, padahal yang belum didukung hanya satu-dua kartu di dalamnya. Registry
> sekarang memberi satu kunci untuk satu widget.

### Halaman yang membaca data nyata

| Halaman | Endpoint |
|---|---|
| Tasks | `/api/tasks/list`, `/api/tasks/{id}/output` |
| Datasets | `/api/datasets/list`, `/preview`, `/upload` (termasuk unduh Hugging Face) |
| Model Registry | `/api/models/catalog` — juga sumber pemilih model untuk deploy vLLM |
| Deployments | `/api/serve/info`, `/api/serve/vllm`, `/api/adapters`, `/api/serve/gateway` |
| Interact | `/api/chat` |
| Fine-tune | `/api/finetune/*` |
| Evals | `/api/evals/*` |
| Prompt Registry | `/api/prompts/*` |
| Traces | `/api/traces` |

**"Unreachable" bukan tanda mock.** Itu hasil probe jujur: mesinnya memang mati
atau belum dikonfigurasi (`VLLM_BASE_URL` kosong). Begitu pula "Total Models 0"
di Model Registry — katalog backend memang kosong, halamannya tetap nyata.

### Kartu placeholder yang dihapus (24 September 2026)

Enam entri mock terakhir tidak pernah punya backend dan hanya menampilkan nol.
Yang benar-benar tampil di layar dihapus dari UI:

| Dihapus | Di mana |
|---|---|
| "Used by: N workflows" | kartu dataset |
| Sortir "Usage count" | filter dataset |
| Min VRAM Required, Recommended GPU, GPU Count Required, Deployment Readiness | detail model |

Sisanya (`model.usage`, `model.evaluation`, `task.resourceMonitor`,
`task.costEstimate`) ternyata **tidak pernah dirender di komponen mana pun** —
hanya field bernilai nol di lapisan data, jadi cukup dihapus dari registry.

### Suite RAG tidak ada

Empat entri `rag.*` di registry lama adalah sisa rencana yang tidak pernah
dibangun: tidak ada halaman, route, maupun modulnya di `src/`. Entri-entri itu
sudah dihapus agar tidak menyesatkan pembaca berikutnya.

### Penandanya belum terpasang

`MockBadge` dan `MockBanner` ada di `src/components/ui/`, tetapi **tidak dipakai
di satu halaman pun**. Artinya label di registry ini murni catatan pengembang —
tidak pernah tampil ke pengguna dan tidak membatasi apa pun. Itu sebabnya tidak
ada titik merah di dashboard.

> Perbarui file ini dengan bukti, bukan asumsi — cara memverifikasi: telusuri
> `fetch("/api/` di modul yang bersangkutan, lalu pastikan route-nya benar-benar
> ada di `src/app/api/`.

---

## 8. Keputusan teknis

### Backend disalin dan akan ditulis ulang

Transformer Lab dipakai agar bisa bergerak cepat, bukan sebagai pilihan akhir.
Rencananya diganti dengan implementasi Rust. Semua keputusan lain mengikuti dari sini:
jangan menanam logika di `backend/`, dan jangan membangun ketergantungan pada detail
internalnya.

### Trainer dipegang sendiri

Awalnya job memakai trainer milik upstream, yang berarti perilaku seperti kuantisasi
dan penanganan dataset gagal **mustahil diubah dari sisi kita**. Sejak trainer di-fork
ke repo ini, perilaku itu bisa dikendalikan — dan perubahan paling berpengaruh ke mutu
model justru ada di sana, bukan di hyperparameter.

### Satu permukaan inferensi

Semua engine diakses lewat protokol OpenAI. Konsekuensinya menyenangkan: menukar
Ollama dengan vLLM atau llama.cpp tidak menyentuh kode aplikasi, dan klien pihak ketiga
bisa memakai SDK OpenAI biasa.

### Pin image backend berdasarkan digest

Image backend dipin per digest, bukan tag `latest`. Menarik ulang dari `latest` pernah
merusak auth — gejalanya mirip kehilangan data, padahal skemanya utuh dan hanya perlu
menerbitkan ulang kunci.

---

## 9. Jebakan yang sudah pernah menggigit

Daftar ini bukan teori. Semuanya sudah pernah terjadi dan memakan waktu.

### `guided_json` diterima lalu diabaikan

Pada vLLM yang dipakai, parameter `guided_json` di tingkat atas diterima tanpa error
lalu **tidak pernah dipakai**. Permintaan sukses, sampler tidak pernah dibatasi.
Gunakan `response_format: {type: "json_schema"}`.

Yang membuatnya berbahaya: keluaran tetap terlihat benar selama modelnya kebetulan
terlatih mengeluarkan JSON. Pagarnya tidak pernah berjalan, dan tidak ada yang tahu.

### `minItems`/`maxItems` tidak ditegakkan

Skema menjamin **bentuk** tiap item, bukan **cacahnya**. Terukur: model mengeluarkan 7
item saat diminta 5 meski batasnya dipasang. Potong sendiri setelah JSON diparse.

### `max_steps` positif menimpa jumlah epoch

Nilai positif membuat training berhenti lebih awal, tetapi log terbaca seperti job yang
selesai normal. Kunci di `-1` agar jumlah langkah mengikuti epoch.

### Loop tunggu yang habis waktunya harus gagal

Sebuah watcher kehabisan iterasi lalu **melanjutkan ke langkah berikutnya** —
menyalakan engine sementara training masih berjalan di 78%. Keduanya berebut GPU
yang single-tenant, NVML rusak, dan training gagal dua kali.

Aturannya: loop tunggu yang kehabisan waktu harus **gagal**, bukan lanjut.

### GPU harus benar-benar bebas sebelum training

Engine dihentikan dan memori bebas diverifikasi sebelum job dimulai. Kalau tidak
terverifikasi bebas, batalkan dan nyalakan kembali engine — jangan lanjut dengan
harapan.

### Escaping di heredoc merusak diam-diam

Menulis skrip berisi regex atau escape lewat heredoc bash pernah mengubah pola menjadi
byte kontrol. Akibatnya pemeriksa **selalu lolos** karena polanya tidak pernah cocok
dengan apa pun.

Tulis berkas lewat editor, bukan heredoc. Dan setelah sebuah pemeriksa melaporkan
bersih, uji dulu pemeriksanya dengan kasus yang wajib ditolak.

### Disk penuh menggagalkan training di tengah jalan

Image dan artefak menumpuk sampai 98%. Training butuh ruang untuk checkpoint, dan
kalau habis di tengah, kegagalannya membingungkan. Periksa ruang kosong sebelum job
panjang.

---

## Rujukan

| Berkas | Isi |
|---|---|
| `docs/SETUP.md` | Menyiapkan lingkungan pengembangan |
| `docs/DEPLOY-PORTAINER.md` | Deployment lewat Portainer |
| `docs/ROADMAP.md` | Rencana pengembangan |
| `backend/README.VENDORED.md` | Provenance backend dan rencana migrasi |
| `trainers/unsloth-llm-train/train.py` | Trainer, dengan deviasi didaftar di docstring |
| `src/lib/feature-status.ts` | Status tiap fitur terhadap backend |
| `src/lib/inference.ts` | Konfigurasi koneksi engine |
| `docker-compose.portainer.yml` | Definisi layanan, termasuk adapter yang dipatri |
