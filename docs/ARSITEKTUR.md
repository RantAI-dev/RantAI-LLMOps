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
10. [Gambar dan VLM](#10-gambar-dan-vlm)

---

## 1. Gambaran umum

RantAI-LLMOps adalah antarmuka web untuk siklus hidup model bahasa: impor model dan
dataset, fine-tune, evaluasi, ekspor, lalu serving — semuanya di infrastruktur sendiri.

Sistemnya terdiri dari tiga lapis:

```
┌─────────────────────────────────────────────────────────┐
│  Frontend — Next.js 16 (App Router)                     │
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

Next.js 16 dengan App Router (`src/proxy.ts` menggantikan middleware). Berperan ganda sebagai UI dan sebagai BFF
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

### SGLang

Engine ketiga (`SGLANG_BASE_URL`), bentuknya sama dengan vLLM: satu model dasar plus
adapter LoRA, dipilih per permintaan. Dua perbedaan yang gagal diam-diam kalau tidak
ditangani:

1. **Cara memilih adapter.** SGLang memakai `model: "base:ask"`. Nama lain apa pun —
   `ask` saja, salah ketik, adapter yang sudah dilepas — dijawab model dasar dengan
   status 200. `sglangRequestModel` (`src/lib/inference-engines.ts`) menerjemahkan
   nama yang dipakai klien dan menolak sisanya dengan 404. Gateway melakukan hal yang
   sama bila `GATEWAY_ENGINE=sglang` (`docker/backend/gateway.py`, layanan
   `rantai-gateway-sglang`, port 11440): `ask` atau `base:ask` diteruskan sebagai
   `base:ask`, nama yang tidak dilayani dijawab 404 tanpa diteruskan ke SGLang.
2. **`target_modules` milik Unsloth.** Unsloth menyimpannya sebagai regex; SGLang hanya
   menerima `all` atau daftar modul. Entrypoint "Deploy SGLang"
   (`src/lib/serve-sglang-container.ts`) menyalin adapter ke `/tmp/loras` di dalam
   container lalu menulis daftar modul dari isi bobotnya. Berkas adapter asli tidak
   diubah karena vLLM membaca berkas yang sama.
3. **Pasang/lepas adapter tanpa restart.** Kartu "SGLang LoRA adapters" di Deployments
   memanggil `/load_lora_adapter` dan `/unload_lora_adapter` (`src/lib/engine-lora.ts`).
   Adapter Unsloth perlu disiapkan dulu, jadi entrypoint menjalankan helper kecil di
   port internal 30001: `POST /prepare` membuat salinan di `/tmp/loras-hot/<nama>`
   (symlink ke berkas asli + config berisi daftar modul), `GET /adapters` mendaftar
   adapter hasil training di volume TL. Pool memori LoRA ditetapkan saat start, jadi
   entrypoint memasang `--max-lora-rank` minimal 16 (`SGLANG_MAX_LORA_RANK`, rank
   bawaan trainer); adapter dengan rank lebih besar harus ikut saat deploy atau nilai
   itu dinaikkan. Menaikkannya memakan KV cache: di GB10 dengan SEA-LION 8B, 16 → 32
   mengurangi KV cache dari ±28,7 ribu menjadi ±19,3 ribu token. Adapter yang dipasang dicatat di
   `adapter-manifest-sglang.json` dan dipasang ulang otomatis setelah SGLang restart,
   sama seperti vLLM: saat frontend start dan tiap `ADAPTER_RECONCILE_INTERVAL_S`
   detik (60; `src/instrumentation.ts`). Selama jeda itu, permintaan ke adapter yang
   hilang dijawab 404, bukan model dasar. Diuji di box: restart `rantai-sglang-8b`
   (±140 detik) → tiga adapter bawaan kembali sendiri, adapter tambahan pulih lewat
   reconcile.

`--mem-fraction-static` dihitung dari memori GPU yang **bebas** saat container mulai,
bukan dari total. Di GB10 dengan SEA-LION 8B, 0,38 ≈ 24 GB (bobot 17,7 GB + KV cache
26 ribu token).

**Beban engine.** Halaman Traces menampilkan panel "Engine load" dari `/metrics`
Prometheus milik vLLM dan SGLang (`src/lib/engine-metrics.ts`, `/api/serve/metrics`,
diperbarui tiap 5 detik): permintaan berjalan dan antre, pemakaian KV cache, token
keluaran per detik, rata-rata TTFT dan latensi, cache hit prefix, dan slot LoRA SGLang.
Angka kumulatif dihitung sejak engine start, termasuk lalu lintas yang tidak lewat LLMOps.

### Adapter dipatri, bukan ditempel

Adapter yang dimuat saat berjalan **hilang begitu engine dimuat ulang**. Setelah
restart, permintaan ke adapter itu gagal — atau lebih buruk, diam-diam dilayani versi
lama. Karena itu setiap adapter dipatri di konfigurasi serving.

Nama yang dilayani adalah **peran, bukan versi**. Menaikkan versi cukup memindahkan
penunjuknya; kode klien tidak berubah.

### Model keputusan (System One)

Selain LLM, LLMOps melatih dan menyajikan **model keputusan**: satu model bahasa dengan
kepala klasifikasi yang menjawab beberapa pertanyaan bertipe (pilihan, ya/tidak/tidak
tahu, skor) beserta probabilitasnya. vLLM, Ollama, dan llama.cpp tidak bisa melayaninya,
jadi ada server tersendiri.

```
Klien ──► gateway-decision (API key) ──► rantai-decision (PyTorch, /v1/systemone) ──► GPU
                                          ▲
Fine-tune (metode "decision") ─ adaptor ──┘  dimuat lewat Deployments → Decision models
```

- **Trainer:** `trainers/unsloth-decision-train/`, dijalankan sebagai job TL subtipe
  `DECISION` (bukan `TRAIN`). Dataset: JSONL/JSON `{state, questions, gold}`, divalidasi
  oleh pemeriksa TypeScript dan Python yang berbagi satu fixture uji.
- **Server:** `docker/decision/server.py`. Muat/bongkar model lewat rute admin
  (token terpisah); rute admin **tidak pernah** diteruskan gateway.
- **Eval:** tab Decision di Evals mengirim tiap baris test set ke model yang *sedang
  disajikan* lewat jalur yang sama dengan klien, lalu menghitung metrik. Run berjalan di
  server (boleh ditutup halamannya) dan disimpan satu file per run.
- **Test set** berasal dari file test sebuah dataset (terdaftar otomatis, tidak pernah
  menimpa set yang sudah ada), unggahan di Evals, atau split Hugging Face.

### Menambah dataset

Satu pintu: dialog "Add dataset" (Datasets dan Fine-tune) → `POST /api/datasets/upload`
→ `ingestDataset` di `src/lib/finetune.ts`. Browser meninjau 1 MB pertama memakai
parser yang sama dengan server, tetapi **server memvalidasi ulang seluruh berkas** dan
tidak menyimpan apa pun kalau ditolak. Batas 100 MB; tujuan workspace atau S3.

### Jejak permintaan dari gateway

Gateway dapat menulis satu baris metadata per permintaan (model, status, token, latensi —
**tanpa teks prompt maupun jawaban**) ke `inference-log.jsonl` yang dibaca halaman
Traces. Aktifkan dengan `GATEWAY_TRACE_FILE=/data/inference-log.jsonl` dan pasang volume
data aplikasi ke gateway. Mati secara bawaan; kegagalan menulis tidak pernah mengganggu
permintaan.

> **Catatan keamanan:** gateway yang menerima trace harus memasang seluruh volume data
> aplikasi (`/data`, yang juga memuat konfigurasi gateway dan pengaturan) dengan hak tulis.
> Kodenya hanya menambahkan satu baris ke log, tetapi gateway menghadap jaringan; aktifkan
> hanya di gateway yang memang perlu tercatat. Di UGM baru `rantai-gateway-decision` yang
> aktif; tiga gateway lain (memakai image backend) belum.

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

### Next.js diam-diam memotong body di atas 10 MB

Next 16 membatasi body permintaan yang melewati proxy sebesar 10 MB dan **memotongnya
tanpa error**: unggahan 15 MB tampak sukses dengan baris yang hilang. Batasnya dinaikkan
lewat `experimental.proxyClientMaxBodySize` (110 MB, di atas batas dataset 100 MB).
Verifikasi dengan berkas besar sungguhan, bukan hanya yang kecil.

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

## 10. Gambar dan VLM

Model yang membaca gambar (SEA-LION v4 8B VL = Qwen3-VL, Gemma-SEA-LION v4 4B VL = Gemma-3) dilayani,
dilatih, dan dievaluasi lewat LLMOps. Rencana dan hasil uji: `docs/RENCANA-VLM.md`.

### Format konten

Satu format di seluruh jalur: `content` berupa string **atau** array bagian OpenAI,
`{type:"text"}` dan `{type:"image_url", image_url:{url}}`. vLLM, SGLang dan `/v1` Ollama sudah memahaminya,
jadi tidak ada konversi di tengah. Aturannya ada di satu tempat, `src/lib/chat-content.ts` (murni, dipakai
browser dan server): URL gambar boleh `data:image/(png|jpeg|webp|gif);base64,...`, rujukan tersimpan
`/api/chat-images/<sha256>`, atau `https://` pada host publik. `file://`, `http://`, host privat, nama satu
label (alias Docker) dan IPv6 ditolak karena engine yang mengambil URL itu. Batas bawaan (env): 4 gambar per
pesan, 8 per permintaan, 8 MB per gambar, 24 MB per body (di bawah 32 MB milik gateway). Pelanggaran jumlah = 400,
ukuran = 413.

### Chat

```
Playground ──(array content, gambar = rujukan /api/chat-images/<sha>)──► /api/chat
   /api/chat: batas body → validateMessages → tolak model yang PASTI teks-saja →
              tukar rujukan jadi data URL → engine (vLLM / SGLang / Ollama)
```

- Gambar dikecilkan di browser (sisi terpanjang ≤ 1280 px, JPEG) lalu disimpan sekali sebagai
  `$RANTAI_DATA_DIR/chat-images/<sha>`; percakapan hanya menyimpan rujukan. Daftar percakapan tetap kecil
  (10 percakapan bergambar ≈ 4 KB). `pruneChatImages` membuang gambar yang tak dirujuk dan lebih tua dari 7 hari,
  dan **tidak menghapus apa pun** bila daftar percakapan tidak bisa dibaca.
- Kemampuan vision: `src/lib/model-capabilities.ts` (satu sumber untuk Playground, Fine-tune, Evals) memakai
  `vision_config`, arsitektur, `pipeline_tag`, `capabilities` Ollama, dan nama model. vLLM/SGLang tidak
  melaporkan kemampuan, jadi hanya kecocokan nama yang positif yang berarti; "tidak cocok" = tidak diketahui
  dan permintaan tetap dilewatkan (engine yang memutuskan). Hanya model Ollama yang jelas tanpa `vision` yang ditolak.
- Batas di engine (`DeployVllmParams.limitMmImages/maxImagePixels`): vLLM
  `--limit-mm-per-prompt '{"image":N}'` dan `--mm-processor-kwargs '{"max_pixels":N}'`; SGLang
  `--limit-mm-data-per-request` dan `--mm-process-config`. Hanya dipasang bila diisi **dan** basenya vision.
  Satu token gambar Qwen3-VL ≈ 32×32 piksel (+22 token tetap); tanpa batas, gambar 16 juta piksel bisa belasan
  ribu token. Gemma-3 selalu 256 token per gambar.

### Dataset bergambar

ZIP: `train.jsonl` (wajib), `eval.jsonl` (opsional), `images/**`. Satu baris =
`{"messages":[user(image + text), assistant]}`; path gambar relatif (tanpa `..`), atau `https://`/`s3://`.
Validator ada dua dan kembar: `src/lib/vlm-schema.ts` dan `trainers/unsloth-vision-train/vlm_schema.py`,
dikunci oleh satu fixture (`fixtures/vlm_cases.jsonl`, 58 kasus). Browser memeriksa seluruh ZIP, **server memeriksa
ulang** semuanya terhadap gambar yang benar-benar tersimpan; satu gambar hilang saja sudah menolak.

Unggah (`/api/datasets/vision/*`): `init` → gambar per batch (≤ 20 MB) → `complete` (menulis JSONL, validasi ulang;
gagal = dataset dihapus). Ke workspace, tiap gambar lewat API unggah bertahap Transformer Lab
(`/upload/init`, chunk, `/upload/complete`, lalu `/data/fileupload?upload_id=&relpath=images/x.png`) karena
`/data/fileupload` biasa mengabaikan `relpath`; ±0,3 dtk per gambar (2.200 gambar ≈ 11,5 menit). Tata letak:
`<workspace>/datasets/<id>/{train.jsonl, eval.jsonl, images/}` atau `s3://bucket/prefix/<id>/...`.
Status unggahan yang terbuka disimpan di memori satu proses (restart server = mulai ulang). `DELETE` hanya untuk
unggahan yang masih terbuka; dataset S3 yang sudah selesai belum punya tombol hapus.

### Trainer vision

`trainers/unsloth-vision-train/` (stack pustaka sama dengan trainer decision: torch 2.10+cu130, unsloth 2026.10.8,
transformers 5.17, trl 1.15). Beda dari trainer SFT teks:
- Model dimuat dengan `FastVisionModel`, `device_map={"":0}` (tanpa offload ke CPU saat GPU dipakai bersama).
- Data tetap `messages` dengan gambar; gambar didecode malas per baris (`vlm_data.as_hf_dataset` membungkus
  dataset sebagai `datasets.Dataset` dengan `with_transform`, karena `SFTTrainer` menolak tipe lain).
- Loss hanya pada jawaban. Penanda giliran diturunkan dari template chat model; sebelum training, satu batch
  diperiksa (0% atau 100% dilatih = gagal; token gambar tidak boleh dilatih; token akhir giliran harus dilatih).
- Audit panjang menghitung token gambar. Adapter disimpan **bersama processor** (bukan hanya tokenizer).
- Lapisan vision dibekukan secara bawaan. LoRA di vision tower hanya bisa dilayani vLLM
  (`--enable-tower-connector-lora`), tidak oleh SGLang.

### Serving adapter VL

vLLM melayani adapter bahasa seperti adapter teks (`--enable-lora`). SGLang hanya menerapkan LoRA pada modul bahasa:
`serve-sglang-container.ts` membaca header safetensors adapter dan **menolak** adapter yang menyentuh
`visual.`/`vision_tower`/`multi_modal_projector` dengan pesan yang menyebut jalan keluarnya, di entrypoint dan di
helper pasang-saat-jalan.

### Eval bergambar

`Evals → Vision` meniru eval Decision: runner di server (boleh menutup halaman), satu berkas per run di
`$RANTAI_DATA_DIR/vlm-eval-runs`, set uji di `$RANTAI_DATA_DIR/vlm-eval-sets/<id>/{meta.json,rows.jsonl,images/}`.
Model yang **sedang dilayani** dipanggil lewat jalur klien; permintaan gagal = `case.error`, bukan salah.
Penilaian murni di `src/lib/vlm-eval.ts`: `exact`, `latex` (buang `$`, `\[ \]`, pagar kode dan semua spasi, plus CER),
`numeric` (±5% seperti ChartQA, jadi "2019" vs "2017" dihitung benar), `anls`, `choice`.
Prompt set ChartQA harus meminta jawaban pendek, kalau tidak model menjawab kalimat dan semua baris salah.

### Jebakan baru

- **`SFTTrainer` hanya menerima `datasets.Dataset`/`IterableDataset`** — dataset map-style buatan sendiri gagal
  setelah semua persiapan lain lolos. Bungkus dengan `Dataset.with_transform`.
- **Router percakapan TL mengurutkan dengan `updatedAt`**: satu percakapan yang `updatedAt`-nya bukan string ISO
  membuat seluruh daftar menjadi `[]` (GET gagal diam-diam, UI tampak kosong) sampai berkas itu dihapus.
- **Gambar di riwayat chat**: jangan simpan base64 di percakapan; sesi seluruhnya dikirim ulang tiap 500 ms saat stream.
- **CSP `img-src` tidak punya `blob:`**; pratinjau memakai data URL, bukan `URL.createObjectURL`.
- **`node_modules` repo dibuat di Windows** (modul native `win32` saja): tes di Linux memakai salinan terpisah.

---

## Rujukan

| Berkas | Isi |
|---|---|
| `docs/SETUP.md` | Menyiapkan lingkungan pengembangan |
| `docs/DEPLOY-PORTAINER.md` | Deployment lewat Portainer |
| `docs/ROADMAP.md` | Rencana pengembangan |
| `backend/README.VENDORED.md` | Provenance backend dan rencana migrasi |
| `trainers/unsloth-llm-train/train.py` | Trainer, dengan deviasi didaftar di docstring |
| `trainers/unsloth-vision-train/train.py` | Trainer vision (VLM), lihat bagian 10 |
| `docs/RENCANA-VLM.md` | Rencana, keputusan dan hasil uji VLM |
| `src/lib/feature-status.ts` | Status tiap fitur terhadap backend |
| `src/lib/inference.ts` | Konfigurasi koneksi engine |
| `docker-compose.portainer.yml` | Definisi layanan, termasuk adapter yang dipatri |
