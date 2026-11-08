# Rencana Eksekusi — VLM (Vision-Language Model) di LLMOps

> Ditulis 6 November 2026 dari pembacaan kode (commit `7186d5d`) dan kondisi box GB10.
> Untuk dieksekusi bertahap oleh agen (Claude Sonnet) atau anggota tim. Brief singkatnya
> ada di [ROADMAP.md](ROADMAP.md) → "1. Vision — VLM". Dokumen ini versi rincinya.

## Status eksekusi (diperbarui 8 November 2026)

| Fase | Status | Catatan |
|---|---|---|
| 0 Verifikasi di box | selesai | hasil di "Hasil Fase 0"; base training = Gemma-SEA-LION 4B VL |
| 1 Fondasi | selesai | `chat-content.ts`, `model-capabilities.ts` |
| 2 Playground + serving | selesai, teruji | 20/20 API; tombol lampiran diklik di browser; batas gambar (4 gambar, 1.048.576 piksel) **aktif di `rantai-vllm-8b` produksi sejak 7 Nov** |
| 3 Dataset bergambar | selesai, teruji di :3010 | 2.000 baris masuk; ZIP rusak ditolak; S3 fixture OK (sisa fixture di S3) |
| 4 Trainer vision | selesai, teruji di GPU | teruji juga lewat TL (job 10 langkah, 7 Nov 2026; lihat UJI-END-TO-END §9) |
| 5 Serving adapter VL | selesai, teruji | vLLM melayani adapter; SGLang menolak adapter vision |
| 6 Eval bergambar | 6.1 selesai, teruji; 6.2 tidak dikerjakan | adapter TL 3 epoch: LaTeX 0,7% → 16,0% exact (CER 0,417 → 0,198); ChartQA 57,7% → 62,7% |
| 7 GGUF VL | terbukti lewat skrip, belum lewat UI | merge VL → GGUF q8_0 + `mmproj` (llama.cpp b12182) menjawab satu gambar di CPU dan GPU; Ollama tidak dipakai untuk VL; `export.ggufVision` tetap `planned` karena jalur UI belum diuji |
| 8 E2E, dokumen, rilis | selesai | `scripts/e2e.js` area Vision 17/17 di produksi; v0.44.0 dirilis dan frontend produksi memakai image GHCR-nya |

Perbedaan dari rencana awal: base training 4B (8B tidak muat); dataset diunggah per gambar lewat API unggah bertahap TL
(`/data/fileupload` biasa mengabaikan `relpath`); `SFTTrainer` butuh `datasets.Dataset` (dibungkus `with_transform`);
ChartQA butuh instruksi jawaban pendek; ZIP eval dibatasi 100 MB. Laporan uji lengkap: `UJI-END-TO-END.md` §9.

## Daftar isi

0. [Tujuan, lingkup, dan ukuran selesai](#0-tujuan-lingkup-dan-ukuran-selesai)
1. [Aturan kerja untuk eksekutor](#1-aturan-kerja-untuk-eksekutor)
2. [Peta kondisi sekarang](#2-peta-kondisi-sekarang)
3. [Keputusan desain](#3-keputusan-desain)
3b. [Dataset demo dan skenario demo](#3b-dataset-demo-dan-skenario-demo)
4. [Fase 0 — Verifikasi di box](#fase-0--verifikasi-di-box-tanpa-kode)
5. [Fase 1 — Fondasi bersama](#fase-1--fondasi-bersama)
6. [Fase 2 — Playground + serving gambar](#fase-2--playground--serving-gambar)
7. [Fase 3 — Dataset bergambar](#fase-3--dataset-bergambar)
8. [Fase 4 — Trainer vision](#fase-4--trainer-vision)
9. [Fase 5 — Serving adapter VL](#fase-5--serving-adapter-vl)
10. [Fase 6 — Eval bergambar](#fase-6--eval-bergambar)
11. [Fase 7 — Export GGUF VL (opsional)](#fase-7--export-gguf-vl-opsional)
12. [Fase 8 — Uji end-to-end, dokumen, rilis](#fase-8--uji-end-to-end-dokumen-rilis)
13. [Risiko](#risiko)
14. [Keputusan pengguna (jawaban pertanyaan terbuka)](#keputusan-pengguna-6-november-2026)
15. [Lampiran: template prompt per fase](#lampiran-template-prompt-per-fase)

---

## 0. Tujuan, lingkup, dan ukuran selesai

**Tujuan.** LLMOps bisa menjalankan satu siklus penuh model VL: unggah dataset bergambar →
fine-tune → eval naik dibanding base → serve → ditanya dengan gambar dari Playground dan
dari RantAI Agents lewat gateway.

**Kenapa.** Base yang sudah dipakai (SEA-LION v4 8B VL di `rantai-vllm-8b`, Gemma-SEA-LION
v4 4B VL) sudah bisa melihat, tetapi LLMOps hanya memakainya untuk teks.

**Keputusan pengguna (6 November 2026):**

| Hal | Keputusan |
|---|---|
| Lingkup | **Sampai training dengan data bergambar** (Fase 0–6 wajib, Fase 7 opsional) |
| Kasus pakai | Tidak harus kasus RantAI Agents. Yang penting fiturnya jalan dan bisa didemokan ke Pak Risman |
| Data | Tidak ada dataset internal → pakai **dataset open source** (lihat [§3b](#3b-dataset-demo-dan-skenario-demo)) |
| Base | **SEA-LION v4 8B VL** bila muat di memori saat training; kalau tidak muat, **Gemma-SEA-LION v4 4B VL** (aturan di Fase 0.7) |
| Produksi | **Boleh** menyalakan batas multimodal di `rantai-vllm-8b`, yang berarti restart engine (prosedur di Fase 2.4) |

**Di dalam lingkup**
- Input gambar di Playground (unggah, tempel, seret) dan di jalur gateway.
- Dataset bergambar (JSONL `messages` + folder gambar, dikemas ZIP) ke workspace atau S3.
- Trainer vision baru: LoRA lapisan bahasa dan/atau vision, data bergambar.
- Serving adapter VL di vLLM dan SGLang.
- Eval dataset sendiri (jawaban vs kunci) dan benchmark VL standar.
- Export GGUF VL (opsional, hanya arsitektur yang didukung llama.cpp).

**Di luar lingkup**
- Video dan audio.
- Melatih vision encoder dari nol.
- OCR pipeline (itu area "4. Vision — OCR" di roadmap; boleh memakai hasil fase ini).

**Ukuran selesai (Definition of Done)** — semua dicek di box, dicatat di `docs/UJI-END-TO-END.md`:
1. Playground: gambar + pertanyaan → jawaban yang merujuk isi gambar; riwayat dimuat ulang tetap menampilkan gambar.
2. Gateway: permintaan `image_url` dengan API key → 200; tanpa key → 401; model tak terdaftar → 404.
3. Dataset ZIP bergambar lolos validasi, pratinjau menampilkan thumbnail, gambar hilang ditolak.
4. Fine-tune vision selesai, kurva loss muncul, adapter tersimpan bersama processor.
5. Adapter VL dilayani vLLM (dan SGLang bila didukung) dan menjawab dengan gambar.
6. Eval dataset sendiri: fine-tune > base pada test set terpisah, selisih di luar galat
   (dataset demo: LaTeX_OCR, test split yang tidak pernah dipakai training).
7. `src/lib/feature-status.ts` menandai fitur baru `live`; semua tes lulus.

---

## 1. Aturan kerja untuk eksekutor

Baca ini sebelum menyentuh kode.

1. **Next.js di repo ini versi 16** (bukan 15 seperti di ARSITEKTUR.md). Sebelum menulis kode
   frontend, baca panduan terkait di `node_modules/next/dist/docs/` (aturan `AGENTS.md`).
   `src/proxy.ts` adalah pengganti middleware.
2. **`AI_KNOWLEDGE_LOG.md` wajib diisi** setiap aktivitas berarti: append-only, waktu UTC+7,
   isi tugas, tindakan, berkas, hasil, langkah berikut.
3. **`backend/` (Transformer Lab) jangan diubah.** Atur lewat parameter/env. Kalau benar-benar
   terpaksa, catat alasannya di log dan PR.
4. **Produksi tidak boleh terganggu.** `rantai-vllm-8b` melayani RantAI Agents UGM.
   - Jangan restart, jangan ubah flag, jangan `docker exec` yang menulis berkas ke container
     produksi tanpa izin eksplisit pengguna.
   - Permintaan inferensi baca-saja (satu dua request kecil) boleh untuk verifikasi.
   - Uji fitur serving baru di container terpisah (mis. `vlm-test-*`), dengan memori kecil.
5. **GPU dipakai bersama.** Sebelum training/eval berat, cek memori bebas (`MemAvailable`) dan
   pakai batas kecil. Box: GB10, 128 GB unified memory, sm_121, CUDA 13.
6. **Trainer di-clone dari branch default** saat job mulai. Kode trainer baru harus di-push dulu,
   atau pakai override branch via env seperti `DECISION_TRAINER_BRANCH`
   (`src/lib/finetune.ts:848`). Tambahkan `VISION_TRAINER_BRANCH` dengan pola yang sama.
7. **Tes.**
   - Frontend: vitest, tes ditaruh di samping berkas (`src/**/*.test.ts`). `npm test` / `npx vitest run <file>`.
   - Python: pytest per trainer (`python -m pytest trainers/<dir>`), tanpa GPU.
   - Gateway: `docker/backend/test_gateway.py`.
   - E2E: `scripts/e2e.js` di container frontend, Playwright `tests/*.spec.ts` terhadap box.
8. **Satu fase = satu PR (atau beberapa PR kecil).** Commit hanya bila diminta pengguna; push
   dan deploy ke box selalu minta izin.
9. **Jangan menebak versi pustaka.** Sebelum memakai API Unsloth/transformers/vLLM/SGLang yang
   disebut di sini, cek dokumentasi atau source versi yang di-pin. Rencana ini menandai hal
   yang belum diverifikasi dengan **[verifikasi]**.

---

## 2. Peta kondisi sekarang

Ringkasan hasil pembacaan kode. Nomor baris per commit `7186d5d`; cek ulang sebelum mengedit.

### 2.1 Playground dan jalur chat

| Bagian | Lokasi | Kondisi | Yang rusak untuk konten array |
|---|---|---|---|
| Tipe pesan | `src/modules/playground/types.ts:21-26` | `content: string` | Harus jadi union string \| part[] |
| Kirim + stream | `src/modules/playground/components/chat-area.tsx:98-173` | Hanya teks `input.trim()` | Tombol Send mati tanpa teks (:263) |
| Render | `chat-area.tsx:213` | `{m.content}` | Array → React crash |
| Riwayat | `hooks/use-chat-sessions.ts` → `/api/conversations` → router TL `scripts/setup/conversations.py` | Disimpan di server, sesi penuh di-POST tiap 500 ms saat stream | Judul `messages[0].content.slice` (:154); base64 akan diunggah ulang terus; `list_conversations` mengembalikan semua sesi penuh |
| BFF | `src/app/api/chat/route.ts` | Meneruskan `messages` apa adanya (:87); cek hanya `Array.isArray` | Cabang DEMO `String(content)` (:55); tidak ada batas ukuran per route |
| Engine | `src/lib/inference-engines.ts` | Tidak mengubah `messages` | Aman |
| Batas body | `next.config.ts:47-52` | `proxyClientMaxBodySize: "110mb"` | Aman, tapi perlu batas sendiri |
| CSP | `next.config.ts:28` | `img-src 'self' data: https:` | Tidak ada `blob:` |
| Gateway | `docker/backend/gateway.py` | `MAX_BODY` 32 MB (sudah disiapkan untuk base64), trace hanya metadata respons | Aman |
| Traces / prompt registry | `src/lib/inference-log-store.ts`, `src/lib/prompt-store.ts` | Teks saja | Tidak perlu diubah |

Playground memanggil engine **langsung** (bukan lewat gateway). Compose memasang
`VLLM_BASE_URL=http://vllm:8000/v1` (`docker-compose.portainer.yml:442`), sedangkan
`docs/DEPLOY-PORTAINER.md:16` menyebut `vllm4b:8000` → cek mana yang hidup (Fase 0).

### 2.2 Dataset

| Bagian | Lokasi | Kondisi |
|---|---|---|
| Dialog | `src/modules/datasets/components/add-dataset-dialog.tsx` | Kind `text`/`decision`, satu file `.jsonl/.json/.csv`, pratinjau 1 MB |
| Parser bersama | `src/lib/dataset-ingest.ts` | Semua jadi string JSONL; `detectTextSchema` (:177) **tidak mengenal `messages`** |
| Route | `src/app/api/datasets/upload/route.ts` | `formData()` → `file.text()`, batas 100 MB |
| Simpan | `ingestDataset` (`src/lib/finetune.ts:526`), `createLocalTlDataset` (:365-392) | String saja; S3 via `toPromptCompletionJsonl` menolak `messages` |
| S3 | `src/lib/s3.ts` `putObject` | Body string, satu PUT |
| Upload bertahap TL | `backend/transformerlab/routers/upload.py`, `/data/fileupload?...&relpath=` (`data.py:708`) | **Sudah ada, belum dipakai**; menerima subfolder `images/a.jpg` |
| Validator kembar | `src/lib/decision-schema.ts` + `trainers/unsloth-decision-train/decision_schema.py` + fixture `fixtures/schema_cases.jsonl` | Pola yang ditiru |

### 2.3 Trainer

- `trainers/unsloth-llm-train/train.py`:
  - Mendeteksi VL lewat `vision_config` (L416-423) dan memuat `FastModel` tanpa `device_map={"":0}`.
  - LoRA dipasang dengan `finetune_vision_layers=False` (L465-476).
  - Dataset di-flatten ke kolom `text` (`format_dataset` L533-588); `content` dianggap string.
  - Hanya tokenizer yang disimpan, bukan processor.
- Pin trainer SFT lama: unsloth 2025.12.5, transformers 4.57.3, tanpa torchvision.
- Trainer decision punya stack yang lebih baru dan sudah terbukti di GB10 (`trainers/unsloth-decision-train/task.yaml:21-23`):
  - torch 2.10.0+cu130, torchvision 0.25.0+cu130
  - unsloth/unsloth_zoo 2026.10.8
  - transformers 5.17.0, trl 1.15.0, peft 0.21.2
- Metode di frontend di-hardcode di empat tempat:
  - `src/lib/finetune.ts:679` (tipe)
  - `submitFinetune` `:753` (cabang per metode)
  - `src/app/api/finetune/submit/route.ts:36` (`METHODS`)
  - `src/modules/finetune/components/finetune-form.tsx:15` (`type Method`)
- Pola yang ditiru: metode `decision` (konstanta L145-158, `buildDecisionParameters` L715 + tes).

### 2.4 Serving, eval, export

- **vLLM.**
  - Flag dibangun di `src/lib/serve-vllm-container.ts:27-37` dan `plugins/vllm-serve/run.py:52-68`.
  - `DeployVllmParams` (`src/lib/serve-vllm.ts:55`) belum punya flag multimodal.
  - Tidak ada `--limit-mm-per-prompt` di mana pun, jadi default engine berlaku dan jumlah token gambar tidak dibatasi.
- **SGLang.**
  - Flag dibangun di `src/lib/serve-sglang-container.ts:144-162`.
  - Penulisan ulang `target_modules` (:58 dan helper :87) mengambil nama daun **semua** kunci LoRA.
  - Akibatnya adapter yang menyentuh vision tower kemungkinan besar ditolak SGLang: `get_hidden_dim not implemented` (`sglang/python/sglang/srt/lora/utils.py:293`).
  - `Qwen3VL.should_apply_lora` juga hanya menerima modul LM.
- **Eval.**
  - lm-eval: `src/lib/evals.ts:198` dan `trainers/eleutherai-lm-evaluation-harness`. Daftar tugasnya tetap (`src/lib/benchmarks.ts:25`), teks saja.
  - Merge fine-tune untuk eval memakai `scripts/serve/rantai_merge.sh` dengan `AutoModelForCausalLM`, yang **salah untuk VL**.
  - Eval Decision adalah pola terbaik untuk eval dataset sendiri (detail di Fase 6):
    - route: `src/app/api/evals/decision/route.ts`
    - runner: `src/lib/decision-eval-runner.ts`
    - store: `src/lib/decision-eval-store.ts` via `src/lib/json-dir-store.ts`
    - skor murni: `src/lib/decision-eval.ts`
    - bandingkan: `decision-eval.tsx:306`
- **GGUF.** `scripts/serve/rantai_export_gguf.sh` memakai `AutoModelForCausalLM`, tanpa `--mmproj`.
- **Registry.**
  - Tidak ada flag kemampuan per model.
  - `tlToRegistryModel` meng-hardcode `task: "Chat"` (`src/modules/model-registry/lib/from-tl.ts:60`).
  - Petunjuk yang tersedia: `CatalogModel.architecture`, HF `pipeline_tag`, dan `capabilities` Ollama (`src/lib/ollama.ts:30,61`).

### 2.5 Box (diperiksa 6 Nov 2026)

- `rantai-vllm-8b`:
  - `vllm serve` SEA-LION v4 8B VL dengan nama `base` dan `max_model_len` 8192.
  - Flag: `--enable-lora --max-loras 4 --max-lora-rank 32`, adapter `ask/learn/practice/practicev10e8b`, `--enforce-eager`.
  - Tidak ada flag yang mematikan gambar.
- `rantai-sglang-8b`: SGLang v0.5.23, entrypoint dengan helper LoRA di port 30001.
- Uji satu permintaan bergambar ke produksi **belum dilakukan**. Percobaan lewat `docker exec` yang menulis skrip ke container ditolak oleh pengaman sesi, jadi lakukan dari luar container (Fase 0).

---

## 3. Keputusan desain

Keputusan di bawah adalah rekomendasi. Ubah hanya dengan alasan, dan catat di log.

| # | Hal | Keputusan | Alasan |
|---|---|---|---|
| D1 | Format konten | Pakai format OpenAI apa adanya: `content: string \| Array<{type:"text",text} \| {type:"image_url",image_url:{url}}>` | Engine dan gateway sudah mengerti; tidak ada konversi |
| D2 | Gambar di Playground | Diperkecil di browser (sisi terpanjang ≤ 1280 px, JPEG q≈0,85), dikirim sebagai data URL | Hemat token dan body; tanpa `blob:` di CSP |
| D3 | Gambar di riwayat | Disimpan **terpisah** sebagai berkas `$RANTAI_DATA_DIR/chat-images/<sha256>.jpg`. Pesan menyimpan rujukan `"/api/chat-images/<sha>"`, dan BFF menukarnya ke data URL sebelum diteruskan ke engine | Daftar percakapan tetap kecil; tidak mengunggah ulang base64 tiap 500 ms |
| D4 | Batas | Per gambar ≤ 8 MB setelah decode, ≤ 4 gambar per pesan, ≤ 8 gambar per permintaan, body ≤ 24 MB (di bawah 32 MB gateway) → 413 | Melindungi engine bersama |
| D5 | Token gambar | Engine dibatasi `--limit-mm-per-prompt '{"image":4}'` dan batas piksel processor **[verifikasi nama flag di vLLM/SGLang versi box]** | Konteks 8192; gambar besar bisa ribuan token |
| D6 | Kemampuan model | Fungsi tunggal `modelCapabilities()` → `{vision:boolean}`, dari `config.json` (`vision_config`), arsitektur `*ForConditionalGeneration`/`*VL*`, `pipeline_tag image-text-to-text`, atau `capabilities` Ollama | Satu sumber kebenaran untuk Playground, Fine-tune, Eval |
| D7 | Format dataset | JSONL `messages`, part gambar `{type:"image", image:"images/x.jpg"}` (relatif ke folder dataset) atau URL `https://`/`s3://`; dikemas ZIP: `train.jsonl`, `eval.jsonl` (opsional), `images/` | Sama dengan format Unsloth/TRL; ZIP satu berkas mudah diunggah |
| D8 | Unggah dataset | Browser membuka ZIP (`fflate`), memvalidasi, lalu mengunggah gambar bertahap lewat BFF ke `/data/fileupload?relpath=images/...` milik TL (batch ≤ 20 MB per request); JSONL lewat `ingestDataset` | Tidak perlu memodifikasi backend; tidak mentok 100 MB |
| D9 | Trainer | **Trainer baru** `trainers/unsloth-vision-train/`, bukan cabang di `unsloth-llm-train` | Stack pustaka berbeda; trainer SFT teks tetap stabil |
| D10 | Lapisan yang dilatih | Default: bahasa saja (`finetune_vision_layers=False`). Opsi vision diaktifkan setelah Fase 5 membuktikan engine bisa melayaninya | SGLang (dan mungkin vLLM) belum menerima LoRA vision tower |
| D11 | Eval dataset sendiri | Tiru desain eval Decision: runner di server, satu berkas per run, memanggil **model yang sedang dilayani** lewat jalur klien | Sudah terbukti; tidak butuh GPU tambahan |
| D12 | Benchmark VL | `lmms-eval` terhadap endpoint OpenAI-compatible model yang dilayani **[verifikasi nama model type di lmms-eval]**, jadi tidak perlu merge | Menghindari masalah merge VL dan memori ganda |

---

## 3b. Dataset demo dan skenario demo

### Dataset (diperiksa di Hugging Face, 6 Nov 2026)

| Peran | Dataset | Lisensi | Isi | Ukuran |
|---|---|---|---|---|
| **Utama: training + eval** | [`unsloth/LaTeX_OCR`](https://huggingface.co/datasets/unsloth/LaTeX_OCR) | Apache-2.0 | Gambar rumus → teks LaTeX. Kolom `image`, `text` | train 68.686, test 7.632, ±373 MB |
| Pendukung: eval kemampuan umum (retensi) | [`HuggingFaceM4/ChartQA`](https://huggingface.co/datasets/HuggingFaceM4/ChartQA) | GPL-3.0 (cukup untuk eval internal; jangan didistribusikan ulang di dalam produk) | Gambar grafik + pertanyaan → jawaban singkat. Kolom `image`, `query`, `label` | train 28.299, val 1.920, test 2.500, ±1 GB |

Kenapa LaTeX_OCR jadi yang utama:
- **Perubahan setelah fine-tune terlihat jelas.** Base biasanya menulis LaTeX dengan gaya
  sendiri (spasi, `\dfrac`, pembungkus `$`), sedangkan dataset memakai gaya bertoken yang
  konsisten. Setelah fine-tune, jawaban mengikuti gaya kunci, sehingga skor exact match dan
  CER naik tajam.
- **Gambar kecil** (rumus satu baris), jadi token per gambar sedikit dan training cepat di GPU bersama.
- Lisensi Apache-2.0; ini juga dataset contoh resmi Unsloth untuk fine-tune vision.

ChartQA dipakai untuk memastikan fine-tune tidak merusak kemampuan umum: skor base vs
fine-tune di 300 soal test harus tidak turun di luar galat.

### Skrip penyiap data: `scripts/vlm/make_demo_dataset.py` (baru, Fase 3)

Mengubah dataset HF menjadi ZIP berformat §3.1, supaya demo memakai jalur unggah UI yang sebenarnya:
- `latex-ocr-train.zip`:
  - 2.000 baris acak dari split `train` (seed 0);
  - `eval.jsonl` berisi 200 baris lain dari `train` untuk eval saat training;
  - folder `images/`.
- `latex-ocr-test.zip`: 300 baris dari split **`test`**, dipakai sebagai eval set VL (Fase 6). Tidak pernah dipakai training.
- `chartqa-test.zip`: 300 baris dari split `test`, untuk eval set retensi.
- Prompt seragam di pesan `user`: `"Tulis kode LaTeX untuk rumus di gambar ini. Jawab hanya dengan kodenya."`. Kunci ada di pesan `assistant`.
- Opsi CLI: `--n-train`, `--n-test`, `--seed`, `--out`. Jalan dengan `pip install datasets pillow` di mesin mana pun yang punya internet.
- Tes kecil memakai dataset palsu dua baris (tanpa internet).

Dataset juga bisa dilatih langsung dari id HF (`unsloth/LaTeX_OCR`, `image_column=image`,
`answer_column=text`, prompt tetap) lewat jalur Fase 4.2. Itu jalur kedua untuk diuji.

### Skenario demo ke Pak Risman (±10 menit, setelah Fase 6)

1. **Playground:** unggah foto grafik atau rumus → SEA-LION VL menjawab isi gambar. Ini menunjukkan model produksi sudah bisa melihat lewat LLMOps.
2. **Datasets:** unggah `latex-ocr-train.zip` → pratinjau thumbnail, validasi lolos. Unggah ZIP rusak (satu gambar dihapus) → ditolak dengan alasan.
3. **Fine-tune:** metode "Vision", base VL, dataset tadi → kurva loss turun. Job yang sudah selesai disiapkan sebelumnya, karena training butuh waktu.
4. **Deployments:** pasang adapter `latex-ocr` ke vLLM.
5. **Evals → Vision:** bandingkan base vs `latex-ocr` di `latex-ocr-test` (300 soal held-out). Exact match dan CER naik. Di ChartQA, skor tidak turun.
6. **Playground:** gambar rumus baru, ditanya ke base dan ke `latex-ocr` berdampingan.
7. **Gateway:** satu `curl` dengan API key + gambar, sebagai bukti siap dipakai aplikasi lain (termasuk RantAI Agents).

---

## Fase 0 — Verifikasi di box (tanpa kode)

**Tujuan:** memastikan asumsi sebelum menulis kode. Hasil semua langkah dicatat di
`AI_KNOWLEDGE_LOG.md`.

| # | Langkah | Cara | Hasil yang dicatat |
|---|---|---|---|
| 0.1 | Engine mana yang dipakai Playground | Baca env container `rantai-frontend` (`VLLM_BASE_URL`, `SGLANG_BASE_URL`) lewat Portainer API (inspect, baca-saja) | URL nyata |
| 0.2 | VL produksi bisa melihat | **Minta izin pengguna dulu.** Kirim satu request kecil bergambar (PNG 320×120, dua bentuk berwarna) dari container uji terpisah atau dari frontend container lewat `node -e` tanpa menulis berkas, ke `base` di vLLM. Ulangi ke SGLang | Jawaban benar? `usage.prompt_tokens` untuk gambar itu |
| 0.3 | Biaya token per ukuran gambar | Di container uji (**bukan produksi**): vLLM dengan model yang sama atau model VL kecil, kirim gambar 512², 1024², 2048², catat `prompt_tokens` | Tabel ukuran → token. Untuk Qwen3-VL perkiraan 1 token ≈ 32×32 px **[verifikasi]** |
| 0.4 | Nama flag batas multimodal | Baca `vllm serve --help` dan `sglang.launch_server --help` di image box (`vllm/vllm-openai:cu130-nightly`, `lmsysorg/sglang:v0.5.23-cu130`) | Flag untuk jumlah gambar dan piksel maksimum |
| 0.5 | Arsitektur base | Baca `config.json` di HF cache (volume `rantai-llmops_vllm_hf_cache`) untuk SEA-LION v4 8B VL dan Gemma-SEA-LION 4B VL | `architectures`, `vision_config`, nama template chat, flag thinking (`enable_thinking`?) |
| 0.6 | LoRA vision di vLLM | Baca source vLLM di image box: modul mana dari Qwen3-VL yang didukung LoRA | Bisa / tidak melayani adapter vision tower |
| 0.7 | Unsloth VL di stack decision + **pilih base** | Di container uji dengan stack trainer decision, batch 1, gradient checkpointing, 20 sampel LaTeX_OCR, `max_steps` 5, sambil memantau `MemAvailable` tiap 2 detik: (a) `FastVisionModel.from_pretrained` base **8B VL** bf16; (b) kalau gagal atau melanggar aturan di bawah, ulangi dengan **4B VL** | Jalan / error, memori puncak, detik per langkah, **base terpilih** |
| 0.8 | `chat_template_kwargs` | Cek apakah `{thinking:false}` yang dikirim BFF (`route.ts:102`) cocok untuk template VL, atau perlu `enable_thinking` | Kwarg yang benar per base |
| 0.9 | Dataset demo | Unduh `unsloth/LaTeX_OCR` (±373 MB) dan `HuggingFaceM4/ChartQA` split test ke HF cache box. Cek 5 sampel per dataset: gambar terbaca, kolom sesuai §3b | Ukuran gambar rata-rata, token per gambar (pakai hasil 0.3) |
| 0.10 | Skor base awal | Kirim 20 soal LaTeX_OCR test ke base produksi (baca-saja, `temperature 0`) | Exact match dan CER base. Kalau base sudah > 80% exact, dataset demo kurang menunjukkan perbedaan; laporkan dan usulkan dataset lain |

**Aturan memilih base (0.7).** Pakai **8B VL** bila ketiganya terpenuhi:
- training 5 langkah selesai tanpa OOM;
- `MemAvailable` terendah selama training **≥ 8 GB** (pengaman watchdog 4 GB + cadangan untuk produksi);
- `rantai-vllm-8b` tetap menjawab normal selama uji (cek satu request di tengah).

Kalau salah satu gagal, pakai **4B VL** dan catat angkanya. QLoRA 4-bit untuk 8B adalah
opsi ketiga: hanya dicoba bila pengguna meminta, karena trainer sengaja mematikan 4-bit dan
bitsandbytes di GB10 belum terbukti di trainer SFT.

Training dijalankan saat lalu lintas produksi rendah. Container uji wajib punya watchdog
memori seperti eksperimen weight-edit, yang menghentikan proses bila `MemAvailable` < 4 GB.

**Gerbang:** 0.2 berhasil (model VL produksi benar-benar menjawab isi gambar). Kalau gagal,
berhenti dan laporkan; mungkin perlu flag serving yang berbeda.

### Hasil Fase 0 (dijalankan 6 November 2026)

| # | Hasil |
|---|---|
| 0.1 | Frontend produksi memanggil engine lewat `VLLM_BASE_URL=http://vllm8b:8000/v1` dan `SGLANG_BASE_URL=http://sglang8b:30000/v1` (alias jaringan `rantai-llmops_llmops`; `vllm8b` = `rantai-vllm-8b`). `RANTAI_DATA_DIR=/data` (volume `rantai-llmops_ui_data`). Env S3: `S3_ENDPOINT_URL=http://10.17.254.27:9003`, bucket `buku-korpus`. |
| 0.2 | **Lolos.** SEA-LION 8B VL produksi menjawab benar isi gambar (kotak merah + elips biru) lewat `image_url` base64. Dikirim dari container terpisah di jaringan yang sama (tidak ada yang ditulis ke container produksi). |
| 0.3 | Token prompt per gambar (Qwen3-VL, patch 16, merge 2): ≈ `(lebar/32)×(tinggi/32) + 22`. 320×120 → 92, 512² → 278, 1024² → 1046. Batas bawaan processor `longest_edge` 16.777.216 px (≈ 16 ribu token) → batas piksel memang perlu. Gemma-3 4B VL: tetap 256 token per gambar (896×896). |
| 0.4 | vLLM: `--limit-mm-per-prompt '{"image":N}'`, `--mm-processor-kwargs '{"max_pixels":N}'` (Qwen3-VL membaca `min_pixels`/`max_pixels`), `--enable-tower-connector-lora`, `--allowed-local-media-path`. SGLang 0.5.23: `--limit-mm-data-per-request '{"image":N}'`, `--mm-process-config '{"image":{"max_pixels":N}}'`, `--enable-multimodal`. |
| 0.5 | `Qwen-SEA-LION-v4-8B-VL` = `Qwen3VLForConditionalGeneration` (hidden 4096, 36 layer). `Gemma-SEA-LION-v4-4B-VL` = `Gemma3ForConditionalGeneration` (hidden 2560, 34 layer). Cache HF di box juga berisi Qwen3.5-0.8B/2B dan Qwen3.8-27B. |
| 0.6 | vLLM 0.19.2rc1: Qwen3-VL dan Gemma-3 mm sama-sama `SupportsLoRA`. LoRA untuk vision tower + connector **bisa** dinyalakan dengan `--enable-tower-connector-lora` (bawaan mati). SGLang: `Qwen3VL.should_apply_lora` hanya modul bahasa; tower tidak didukung (Fase 5.2 tetap berlaku). |
| 0.7 | **Base terpilih: Gemma-SEA-LION v4 4B VL.** Uji training stack trainer decision (torch 2.10+cu130, unsloth 2026.10.8, transformers 5.17.0, trl 1.15.0, peft 0.21.2), batch 1, accum 8, 3 langkah, 24 sampel LaTeX_OCR: berhasil. Memuat model 54 dtk, puncak GPU 9,0 GiB, `MemAvailable` turun dari 32,9 ke **15,7 GiB** (≈ 17 GiB terpakai host). 8B (≈ 2× lebih besar) butuh ≈ 30+ GiB → melanggar aturan sisa ≥ 8 GiB, jadi tidak dicoba. Kecepatan stabil ≈ 6–7 dtk/langkah (8 sampel) setelah kompilasi awal (~75 dtk) → 2.000 sampel ≈ 250 langkah ≈ 30 menit. Adapter + processor tersimpan; adapter 476 kunci, **0 kunci vision** (lapisan bahasa saja); generate berjalan. 347 token/sampel (256 token gambar + teks). |
| 0.8 | Template chat kedua base tidak memakai `enable_thinking`/`thinking`, jadi `chat_template_kwargs:{thinking:false}` dari BFF diabaikan template (tidak berbahaya). |
| 0.9 | `unsloth/LaTeX_OCR`: train 68.686, test 7.632; gambar rata-rata 240×47 px (maks 500×100); teks rata-rata 148 karakter, gaya bertoken berspasi (`{ \frac { N } { M } }`). `HuggingFaceM4/ChartQA` test 2.500 (gambar 850×600, `label` berupa list). Tersimpan di volume `vlm-work` (`/w/hf`). |
| 0.10 | Skor base SEA-LION 8B VL (produksi) pada 30 soal uji LaTeX_OCR (seed 0, suhu 0): **exact 2/30, CER rata-rata 0,192**. Model sudah membaca rumus, tetapi gayanya beda (pembungkus `$`, `\,`, `\prime` vs `^ { \prime }`). Ruang perbaikan besar → dataset layak untuk demo. Token prompt rata-rata 103. |

Catatan teknis untuk Fase 4:
- `UnslothVisionDataCollator(model, processor, max_seq_length=None, formatting_func=None, resize="min", ignore_index=-100, train_on_responses_only=False, instruction_part=None, response_part=None, force_match=True, num_proc=None, completion_only_loss=True, ...)` (unsloth_zoo 2026.10.8).
  - `resize="min"` memakai ukuran bawaan model. Untuk Gemma-3 selalu 896², jadi tidak berpengaruh ke jumlah token.
- Venv trainer siap di volume `vlm-work:/w/venv` (5,2 GB). Dataset ada di `/w/hf`. Skrip uji ada di `scratchpad/vlm/` (tidak di repo).
- Sisa disk docker root box saat Fase 0: 128 GB bebas (86% terpakai). Hemat ruang.
- Memori box berfluktuasi 23–33 GiB `MemAvailable` antar uji, jadi selalu cek tepat sebelum job.

---

## Fase 1 — Fondasi bersama

**Tujuan:** tipe dan util yang dipakai semua fase berikutnya. Tanpa perubahan UI.

### 1.1 `src/lib/chat-content.ts` (baru)
- Tipe:
  ```ts
  export type TextPart = { type: "text"; text: string };
  export type ImagePart = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
  export type ContentPart = TextPart | ImagePart;
  export type MessageContent = string | ContentPart[];
  ```
- Fungsi murni:
  - `textOf(c)`: gabungan teks, untuk judul, pencarian, dan DEMO.
  - `imagesOf(c)`
  - `hasImages(c)`
  - `normalizeContent(c)`: string tetap string; array tanpa gambar diratakan ke string supaya engine lama aman.
  - `validateContent(c, limits)` → `{ok} | {error, status: 400|413}`.
- Batas (D4) sebagai konstanta yang bisa ditimpa env: `CHAT_MAX_IMAGES_PER_MESSAGE`, `CHAT_MAX_IMAGES_PER_REQUEST`, `CHAT_MAX_IMAGE_BYTES`, `CHAT_MAX_BODY_BYTES`.
- Validasi data URL: hanya `image/png|jpeg|webp|gif`, base64 sah, ukuran hasil decode.
- URL `https://` diteruskan apa adanya; URL lain (`file://`, `http://` internal) ditolak, supaya engine tidak bisa dipakai untuk SSRF.
- Tes `src/lib/chat-content.test.ts`: string, array teks, array gambar, data URL rusak, MIME salah, terlalu besar, terlalu banyak, `file://` ditolak.

### 1.2 `src/lib/model-capabilities.ts` (baru)
- `visionFromConfig(config)`, `visionFromArchitecture(arch)`, `visionFromPipelineTag(tag)`, `visionFromOllama(capabilities)`.
- `modelCapabilities(source)` → `{ vision: boolean, reason: string }`.
- Pakai di:
  - `CatalogModel` (`src/lib/models-catalog.ts:25`): tambahkan `vision?: boolean`.
  - `tlToRegistryModel` (`from-tl.ts:60`): `task: vision ? "Vision-Language" : "Chat"`.
  - Daftar model vLLM/SGLang untuk Playground. Root `/v1/models` memberi nama base, lalu baca `config.json` lewat HF cache atau API Hub; hasilnya di-cache di memori.
- Tes untuk keempat sumber.

### 1.3 `src/lib/feature-status.ts`
- Tambah kunci berstatus `"planned"`: `playground.imageInput`, `datasets.vision`, `finetune.vision`, `serve.vlmLimits`, `eval.vlmTestSet`, `eval.vlmBenchmark`, `export.ggufVision`.
- Masing-masing diberi komentar `/api/*` yang nanti mendukungnya.

**Selesai bila:** tes baru lulus, `npm run lint` dan `npx tsc --noEmit` bersih.

---

## Fase 2 — Playground + serving gambar

**Tujuan:** pengguna bisa bertanya dengan gambar di Playground, dan klien gateway (RantAI Agents) bisa mengirim `image_url`.

### 2.1 BFF `/api/chat` (`src/app/api/chat/route.ts`)
- Ganti tipe `ChatBody.messages[].content` ke `MessageContent`.
- Sebelum `req.json()`, tolak `content-length > CHAT_MAX_BODY_BYTES` dengan 413 (pola `datasets/upload/route.ts:11,31`).
- Setelah parse, jalankan `validateContent` untuk setiap pesan.
- Selesaikan rujukan `/api/chat-images/<sha>` (D3) menjadi data URL dari disk, dengan pemeriksaan sha yang ketat (`^[a-f0-9]{64}$`).
- Kalau model yang dipilih tidak punya `vision` dan ada gambar → 400 `"model ini tidak menerima gambar"`. Jangan teruskan ke engine.
- Perbaiki cabang DEMO (:55) dengan `textOf`.
- Cek `chat_template_kwargs` sesuai hasil 0.8.
- Tes route baru `src/app/api/chat/route.test.ts` dengan engine di-mock:
  - teks biasa tetap sama persis (regresi);
  - gambar diteruskan;
  - rujukan diganti data URL;
  - 413 dan 400;
  - model non-vision ditolak.

### 2.2 Penyimpanan gambar chat (D3)
- `src/lib/chat-image-store.ts`:
  - `saveChatImage(bytes, mime)` → sha256, tulis atomik ke `$RANTAI_DATA_DIR/chat-images/`. Tiru pola `json-dir-store.ts`: tulis ke berkas sementara, lalu rename.
  - `readChatImage(sha)`
  - `pruneChatImages()`: hapus berkas yang tidak dirujuk percakapan mana pun dan lebih tua dari N hari. Dijalankan di `src/instrumentation.ts` seperti reconcile adapter.
- Route `POST /api/chat-images`: multipart atau data URL, validasi MIME dan ukuran, balas `{ref}`.
- Route `GET /api/chat-images/[sha]`: `Content-Type` sesuai berkas dan `Cache-Control: private, max-age=31536000, immutable`.
- Keduanya di belakang auth yang sama (`src/proxy.ts` sudah menegakkan cookie).
- Tes: simpan/baca, sha jahat (`../`), MIME palsu.

### 2.3 UI Playground (`src/modules/playground`)
- `types.ts`: `ChatMessage.content: MessageContent`.
- Komponen baru `components/image-attach.tsx`:
  - Tombol klip, tempel dari clipboard, dan seret-lepas.
  - Gambar diperkecil di `<canvas>` (D2), lalu `POST /api/chat-images` → `ref`.
  - Thumbnail ditampilkan dari data URL lokal (CSP tidak perlu `blob:`), dengan tombol hapus per gambar.
  - Batas jumlah sesuai D4, dengan pesan galat yang jelas.
- `chat-area.tsx`:
  - `send()` membangun `content` array bila ada lampiran; teks saja tetap string (`normalizeContent`).
  - Tombol Send aktif bila ada teks **atau** gambar (:263).
  - Render (:213): komponen `MessageContentView` yang menampilkan teks (`whitespace-pre-wrap`) dan gambar (`<img src="/api/chat-images/<sha>">`, lebar maks, klik untuk perbesar).
  - Lampiran dinonaktifkan dengan tooltip bila model terpilih tidak `vision` (`modelCapabilities`).
- `use-chat-sessions.ts:154`: judul dari `textOf`, cadangan "Gambar".
- Pastikan sesi hanya berisi rujukan, bukan base64 (cek di tes hook).
- i18n: ikuti `docs/i18n-glossary.md`.
- Tes komponen (vitest + jsdom):
  - lampiran muncul;
  - Send aktif dengan gambar saja;
  - render array;
  - lampiran mati untuk model non-vision.

### 2.4 Batas di engine (D5)
- `DeployVllmParams` (`src/lib/serve-vllm.ts:55`): tambah `limitMm?: { image: number }` dan `maxImagePixels?: number`.
- Teruskan ke:
  - `serve-vllm-container.ts:27-37`
  - `plugins/vllm-serve/run.py:52-68`
  - `serve-sglang-container.ts:144-162`
- Nama flag mengikuti hasil 0.4. Hanya dipasang bila base `vision` (D6).
- Compose (`docker-compose.portainer.yml:132-160`, `:200-219`): tambahkan sebagai variabel env dengan default kosong, supaya produksi **tidak berubah** sampai pengguna memutuskan.
- Form Deploy di Deployments: dua field opsional "Gambar per permintaan" dan "Piksel maksimum per gambar", hanya muncul untuk base VL.
- Tes: `serve-vllm-container.test.ts`, `serve-sglang-container.test.ts` (flag muncul hanya bila diisi dan base VL).

**Menyalakan batas di produksi (`rantai-vllm-8b`, sudah diizinkan pengguna 6 Nov 2026).**
Restart engine memutus RantAI Agents sementara (±2–3 menit), jadi ikuti prosedur ini:
1. **Sebelum.**
   - Simpan inspect container (Cmd, Env, Mounts) ke `AI_KNOWLEDGE_LOG.md` atau berkas cadangan di luar repo.
   - Catat daftar adapter yang dilayani (`/v1/models`).
   - Siapkan satu request teks dan satu request bergambar sebagai pembanding.
   - Pilih jam sepi dan beri tahu pengguna jam pastinya.
2. **Ubah.**
   - Tambahkan nilai env/flag batas (hasil 0.4) lewat konfigurasi container yang sama. Flag lain dan daftar `--lora-modules` jangan diubah.
   - Container lama dipertahankan dengan nama `rantai-vllm-8b-old` (berhenti) sebagai jalur kembali, sama seperti `rantai-frontend-old`.
3. **Sesudah.**
   - Tunggu `/v1/models` siap, lalu pastikan keempat adapter (`ask, learn, practice, practicev10e8b`) muncul lagi.
   - Jalankan request pembanding dan pastikan jawaban teks setara.
   - Kirim satu request lewat `rantai-gateway-vllm` dengan API key.
   - Cek log `rantai-agents-app-1` untuk error ke LLM selama 10 menit.
4. **Kembali** bila ada yang gagal: hentikan container baru, nyalakan `-old`, laporkan.

### 2.5 Gateway
- Tidak perlu perubahan kode. Tambah tes di `docker/backend/test_gateway.py`:
  - body 5 MB berisi `image_url` diteruskan utuh;
  - mode SGLang menulis ulang `model` tanpa merusak array `content`;
  - body > 32 MB → 413.

**Gerbang Fase 2:**
- Di box (setelah deploy frontend dengan izin), gambar di Playground dijawab benar.
- Muat ulang halaman → gambar tetap ada.
- Payload `GET /api/conversations` tidak membengkak (< 100 KB untuk 10 sesi bergambar).
- Request gateway dengan gambar → 200.
- `playground.imageInput` → `live`.

---

## Fase 3 — Dataset bergambar

**Tujuan:** pengguna mengunggah dataset bergambar yang tervalidasi ke workspace atau S3.

### 3.1 Spesifikasi format (D7)
Satu baris JSONL:
```json
{"messages": [
  {"role": "system", "content": "Kamu tutor matematika."},
  {"role": "user", "content": [
    {"type": "image", "image": "images/soal_001.jpg"},
    {"type": "text", "text": "Berapa luas bangun ini?"}]},
  {"role": "assistant", "content": [{"type": "text", "text": "Luasnya 24 cm²."}]}
]}
```
Aturan:
- `messages` berupa array, dan role-nya `system|user|assistant`.
- Minimal satu `user` dan satu `assistant`, dan pesan terakhir adalah `assistant`.
- `content` boleh string atau array part. Part gambar `{type:"image", image:<path|url>}`; sebagai alias, `{type:"image_url", image_url:{url}}` diterima lalu dinormalisasi.
- Gambar hanya di pesan `user`/`system`.
- Path relatif ke folder dataset, tanpa `..`, tanpa absolut, berekstensi `jpg|jpeg|png|webp`. URL `https://` atau `s3://` (bucket di `S3_ALLOWED_BUCKETS`) juga diterima.
- Maks gambar per baris: 4 (bisa dikonfigurasi).
- ZIP berisi `train.jsonl` wajib, `eval.jsonl` opsional, `images/**` berisi gambar.

### 3.2 Validator kembar
- `src/lib/vlm-schema.ts` (aman untuk browser dan server, seperti `dataset-ingest.ts`):
  - `validateVlmRow(row, {imageExists})`
  - `validateVlmJsonl(text, {imageExists})`
  - `vlmDatasetProblem(report)` (≤ 2% baris tidak sah, minimal 20 baris; sama dengan decision)
- `trainers/unsloth-vision-train/vlm_schema.py`: `validate_row` / `validate_rows` dengan aturan identik.
- Fixture bersama `trainers/unsloth-vision-train/fixtures/vlm_cases.jsonl`:
  - setiap baris punya `_expect` dan `_why`;
  - kasus: path `..`, absolut, ekstensi salah, gambar di assistant, tanpa assistant, terlalu banyak gambar, alias `image_url`, URL https, dan gambar yang tidak ada (`imageExists` palsu).
- Tes TS membaca fixture (pola `decision-schema.test.ts:15`); tes Python juga (pola `test_decision_schema.py:104`).

### 3.3 Sekalian: kenali `messages` teks
- `detectTextSchema` (`dataset-ingest.ts:177`): tambah skema `messages` untuk dataset chat teks. Trainer SFT sudah mendukungnya.
- `toPromptCompletionJsonl` (`finetune.ts:419`): jangan dipanggil untuk `messages`; tulis JSONL apa adanya ke S3.
- Tes regresi di `dataset-ingest.test.ts` dan `dataset-save.test.ts`.

### 3.4 Dialog "Add dataset"
- Kind baru `"vision"` (`add-dataset-dialog.tsx:28`), dengan sumber file ZIP.
- Pustaka `fflate` (kecil, jalan di browser).
- Langkah di browser:
  1. Baca daftar isi ZIP, ambil `train.jsonl`/`eval.jsonl`.
  2. Validasi semua baris dengan `imageExists = path ∈ daftar ZIP`.
  3. Tampilkan ringkasan: baris, gambar, gambar hilang, gambar tak terpakai, ukuran.
  4. Pratinjau 8 baris dengan thumbnail (decode gambar ke data URL, maksimal 8).
  5. Tombol Simpan diblokir bila `vlmDatasetProblem` tidak kosong.
- Komponen pratinjau baru `VisionReviewView` di `dataset-review.tsx`.

### 3.5 Unggah (D8)
- Route baru `POST /api/datasets/vision/init` `{name, destination}`:
  - membuat dataset TL (`GET /data/new?dataset_id=`) atau menyiapkan prefix S3;
  - membalas `{id}`;
  - menolak id ganda.
- Route `POST /api/datasets/vision/[id]/files`:
  - multipart berisi beberapa gambar beserta `relpath`, ≤ 20 MB per request;
  - server memvalidasi relpath (`images/...`, tanpa `..`) dan MIME;
  - workspace: teruskan ke TL `/data/fileupload?dataset_id=&relpath=`;
  - S3: `putObject` versi biner.
- Ubah `src/lib/s3.ts` `putObject` supaya menerima `Uint8Array`. Tambah tes; multipart S3 hanya bila satu berkas > 5 GB, jadi tidak perlu sekarang.
- Route `POST /api/datasets/vision/[id]/complete`:
  - unggah `train.jsonl`/`eval.jsonl`;
  - **validasi ulang seluruh JSONL di server** dengan `imageExists` yang memeriksa berkas sudah ada (daftar dari TL atau S3 `list`);
  - kalau gagal, hapus dataset dan balas 400.
  - Eval file juga didaftarkan sebagai eval set VL (Fase 6), mirip `registerEvalSet`.
- Dialog: progress bar per batch, bisa dibatalkan (memanggil `DELETE` untuk membersihkan).
- Batas: total ZIP ≤ 2 GB, per gambar ≤ 10 MB (env `VISION_DATASET_MAX_BYTES`, `VISION_IMAGE_MAX_BYTES`).
- Ref dataset hasilnya: workspace `<id>` (folder), S3 `s3://bucket/prefix/<id>/`. `assertDatasetRef` sudah menerima keduanya.

### 3.6 Detail dataset
- `previewTlDataset` (`finetune.ts:291`): pertahankan sel `data:image` dari `/data/preview` TL (`backend/transformerlab/routers/data.py:214`) dan render sebagai `<img>`.
- Untuk dataset vision, tampilkan thumbnail lewat route `GET /api/datasets/vision/[id]/image?path=` (validasi path ketat).

### 3.7 Dataset HF bergambar
- Tab Datasets di Hub: kalau dataset punya kolom Image (dari API datasets-server `features`), tombol "Use in fine-tune" diarahkan ke metode `vision` dengan ref HF id.
- Trainer vision memuatnya lewat `load_dataset` (Fase 4). Import `/rows` tidak dipakai untuk gambar.

### 3.8 Skrip dataset demo
- `scripts/vlm/make_demo_dataset.py` sesuai [§3b](#3b-dataset-demo-dan-skenario-demo).
- Hasil ZIP disimpan **di luar repo** (mis. folder unduhan atau S3), bukan di-commit.

**Gerbang Fase 3:**
- ZIP contoh (fixture kecil di `tests/fixtures/vision-dataset.zip`, 25 baris, 10 gambar) tersimpan ke workspace dan S3.
- `latex-ocr-train.zip` (2.000 baris) berhasil diunggah lewat UI.
- ZIP dengan gambar hilang ditolak di browser **dan** server.
- `datasets.vision` → `live`.

---

## Fase 4 — Trainer vision

**Tujuan:** fine-tune LoRA model VL dengan data bergambar.

### 4.1 Struktur
```
trainers/unsloth-vision-train/
  task.yaml          # mirror; app mengirim setup/run/parameters inline
  train.py
  vlm_schema.py      # Fase 3
  vlm_data.py        # muat dataset + gambar (bisa diuji tanpa GPU)
  fixtures/vlm_cases.jsonl
  test_vlm_schema.py
  test_vlm_data.py
```
Setup: salin pin stack trainer decision (`unsloth-decision-train/task.yaml:21-23`, termasuk
torchvision cu130) plus `pillow s3fs`. **[verifikasi]** bahwa versi transformers itu mendukung
arsitektur SEA-LION v4 8B VL (hasil 0.5/0.7).

### 4.2 `vlm_data.py` (tanpa import unsloth, supaya bisa dites)
- `resolve_dataset(spec)`:
  - folder lokal atau nama workspace (pola `_load_training_dataset` di `unsloth-llm-train/train.py:158-273`);
  - `s3://.../` ditarik **rekursif** termasuk `images/` (`fs.get(prefix, local, recursive=True)`);
  - id HF.
- `load_rows(dir)`: baca JSONL, validasi dengan `vlm_schema` (gagal kalau melebihi ambang, tidak diam-diam).
- `to_unsloth_messages(row, base_dir)`:
  - part gambar → `{"type":"image","image": <path absolut>}`, `image_url` dinormalisasi;
  - string content → `[{"type":"text","text":...}]`.
- Gambar dimuat **malas** di collator atau `set_transform`, tidak di-decode semua di awal.
- `load_image(path, max_pixels)`:
  - PIL, konversi RGB;
  - perkecil bila melebihi `max_pixels` dengan menjaga rasio;
  - URL https diunduh dengan timeout dan batas ukuran.
- Dataset HF dengan kolom Image dipetakan ke struktur yang sama (kolom gambar + kolom teks dipilih lewat parameter `image_column`, `prompt_column`, `answer_column`, atau kolom `messages` bila ada).

### 4.3 `train.py`
Ikuti kerangka `unsloth-llm-train/train.py` (lab SDK, `LabCallback`, artefak), dengan perubahan:
1. Parameter dari `lab.get_config()`:
   - umum: `model_name, dataset, lr, num_train_epochs, batch_size (default 1), gradient_accumulation_steps (8), warmup_steps, max_steps, max_seq_length (4096), lora_r (16), lora_alpha (16), lora_dropout, logging_steps, save_steps, eval_steps`;
   - baru: `finetune_vision_layers (false), finetune_language_layers (true), max_pixels (1003520 ≈ 1024²), max_images_per_sample (4)`;
   - untuk dataset HF: `image_column, prompt_column, answer_column`.
2. Muat: `FastVisionModel.from_pretrained(model_name, load_in_4bit=False, dtype=bf16, device_map={"":0}, use_gradient_checkpointing="unsloth")`. `device_map` mencegah offload ke CPU saat GPU dipakai bersama.
3. Atur batas piksel processor bila tersedia (`processor.image_processor.max_pixels` untuk Qwen-VL). Gemma-3 berukuran tetap. **[verifikasi]**
4. `FastVisionModel.get_peft_model(finetune_vision_layers=..., finetune_language_layers=..., finetune_attention_modules=True, finetune_mlp_modules=True, r, lora_alpha, lora_dropout, bias="none", random_state=3407)`.
5. Collator: `UnslothVisionDataCollator(model, processor, train_on_responses_only=True, instruction_part=..., response_part=...)` **[verifikasi signature di unsloth 2026.10.8]**.
   - Marker diturunkan dari template model dengan teknik sentinel yang sama seperti `unsloth-llm-train/train.py:711-835`.
   - Pindahkan fungsi itu ke modul bersama atau salin dengan catatan asal.
6. **Cek masker pada batch pertama.** Sebelum training, ambil satu batch dan hitung token yang dilatih:
   - 0% atau 100% → gagal dengan pesan jelas;
   - token gambar **tidak boleh** dilatih;
   - token akhir giliran asisten harus dilatih;
   - catat angkanya di log.
7. Audit panjang: untuk sampel acak (≤ 200), hitung token **termasuk token gambar** lewat processor, lalu log "N/M sampel melebihi max_seq_length". Gagal bila > 20%, karena teks yang terpotong di belakang gambar membuat label hilang.
8. `SFTConfig`:
   - `remove_unused_columns=False`, `dataset_text_field=""`, `dataset_kwargs={"skip_prepare_dataset": True}`, `max_length=max_seq_length`;
   - `per_device_train_batch_size=batch_size`, `bf16=True`, `optim="adamw_torch"` (tanpa bitsandbytes, sama dengan trainer lama);
   - `eval_strategy` bila ada eval split.
   - Eval split: `eval.jsonl`, atau 10% bila ≥ 20 baris (seed 3407).
   - Log loss harus berbentuk dict `'loss': X` supaya kurva UI muncul (`parse-loss.ts`).
9. Simpan adapter + `processor.save_pretrained` + `tokenizer`. Artefak `training_config.json` mencatat `vision: true`, `finetune_vision_layers`, `max_pixels`. Lalu `lab.save_model(dir, name="unsloth_vision_model")`.
10. Error apa pun → `lab.finish` dengan status gagal dan exit 1 (pola L998).

### 4.4 Tes tanpa GPU
- `test_vlm_schema.py` (fixture bersama).
- `test_vlm_data.py`:
  - resolve folder;
  - normalisasi `image_url`;
  - path relatif → absolut;
  - perkecil gambar (PIL in-memory);
  - kolom HF Image;
  - tolak `..`.
- Fungsi marker sentinel diuji dengan template Qwen-VL dan Gemma-3 yang disimpan sebagai fixture string. Tidak perlu memuat model.

### 4.5 Frontend
- Tambah metode `"vision"` di empat tempat (§2.3).
- `src/lib/finetune.ts`:
  - konstanta `VISION_GITHUB_DIR`, `VISION_SETUP`, `VISION_RUN`;
  - `VISION_TRAINER_BRANCH` (env);
  - `buildVisionParameters()` murni + tes di `finetune.test.ts`;
  - cabang di `submitFinetune`;
  - `isVisionJob` (run berisi `unsloth-vision-train`). Pastikan `isTrainJob` tidak salah menggolongkan dan export GGUF teks tidak ditawarkan untuk job vision.
- Route submit (`route.ts:36`): tambah ke `METHODS`, angka baru ke `NUMERIC`. Tolak bila base tidak `vision` (D6) dan bila dataset bukan dataset vision atau id HF.
- Form (`finetune-form.tsx`):
  - tile metode "Vision";
  - daftar base memakai `modelCapabilities`;
  - toggle "Latih lapisan vision" (mati, dengan catatan bahwa engine serving belum tentu bisa melayaninya sampai Fase 5 selesai);
  - field "Piksel maksimum" dan "Gambar per sampel";
  - default `VISION_DEFAULTS`.
- Monitor job memakai komponen yang ada (log + kurva loss).

**Gerbang Fase 4:**
- Job vision di box dengan dataset fixture kecil (≤ 100 sampel, `max_steps` 30, base terpilih di 0.7) selesai.
- Lalu job demo dengan `latex-ocr-train` (2.000 baris, 1 epoch; perkiraan waktu dari detik per langkah di 0.7) selesai. Adapternya diberi nama `latex-ocr`.
- Loss turun.
- Cek masker tercatat.
- Adapter dan processor tersimpan.
- Memori puncak tercatat di log.
- `finetune.vision` → `live`.

---

## Fase 5 — Serving adapter VL

**Tujuan:** adapter hasil Fase 4 dilayani dan menjawab dengan gambar.

1. **vLLM, adapter bahasa saja.**
   - Pasang adapter lewat kartu adapter yang ada (`src/lib/engine-lora.ts` `/v1/load_lora_adapter`) di **container uji**.
   - Cek: request bergambar ke `base` dan ke adapter berbeda jawabannya sesuai data latih.
   - `--max-lora-rank` ≥ rank adapter.
2. **SGLang, adapter bahasa saja.**
   - Penulisan ulang `target_modules` (`serve-sglang-container.ts:58` dan helper :87) harus **membuang kunci di bawah `visual.`, `vision_tower`, `vision_model`, `multi_modal_projector`, `merger`** dan memberi peringatan di log. Kalau setelah dibuang ternyata ada bobot vision, tolak adapter dengan pesan jelas; jangan diam-diam dilayani tanpa bagian itu.
   - Tes di `serve-sglang-container.test.ts`.
3. **Adapter dengan lapisan vision.**
   - Cek dukungan vLLM (hasil 0.6). Kalau tidak didukung: UI fine-tune memberi peringatan dan Deploy menolak adapter itu ke engine yang tidak mendukung.
   - Alternatif: tombol "Gabungkan ke model penuh". Merge VL (`AutoModelForImageTextToText` + `PeftModel.merge_and_unload`, simpan processor), lalu serve sebagai base baru.
   - `scripts/serve/rantai_merge.sh` diberi cabang VL berdasarkan `vision_config`.
4. **Allowlist gateway** untuk adapter baru: alur yang ada, tanpa perubahan.
5. **Manifest dan reconcile adapter** (`adapter-manifest-store.ts`, `adapter-reconcile.ts`) tidak berubah. Cukup tambah tes bahwa adapter vision ikut dipasang ulang.

**Gerbang:**
- Adapter VL dilayani di container uji vLLM, request bergambar lewat gateway uji → 200 dengan jawaban yang mencerminkan fine-tune.
- **Memindahkan ke produksi hanya dengan izin pengguna.**

---

## Fase 6 — Eval bergambar

### 6.1 Eval dataset sendiri (prioritas)
Tiru eval Decision (§2.4), berkas baru:

| Berkas | Isi |
|---|---|
| `src/lib/vlm-eval-set-store.ts` | Set di `$RANTAI_DATA_DIR/vlm-eval-sets/<id>/{meta.json, rows.jsonl, images/}`. Sumber: `eval.jsonl` dataset vision, unggahan ZIP (format §3.1), atau split HF |
| `src/lib/vlm-eval.ts` | Skor **murni**: `exact` (dinormalisasi: huruf kecil, spasi, tanda baca), `latex` (exact setelah membuang semua spasi dan pembungkus `$`/`\[ \]`/kode-blok, plus **CER** = jarak edit karakter / panjang kunci; set LaTeX_OCR memakai ini), `numeric` (relaxed ±5% seperti ChartQA, dipakai set ChartQA), `anls` (ambang 0,5, untuk dokumen), `choice` (huruf A–E dari jawaban). Mode per set di `meta.scoring`. Laporan: akurasi + interval (pakai `scoreInterval` dari `src/lib/eval-stats.ts`), per kategori bila ada kolom `category` |
| `src/lib/vlm-eval-store.ts` | Run di `vlm-eval-runs/<uuid>.json` via `createJsonDirStore` (`keep:30`, `heavy:["cases"]`, `staleMs` 10 menit) |
| `src/lib/vlm-eval-runner.ts` | Worker pool (CONCURRENCY 2, karena engine dipakai bersama), simpan progres per baris. Error request jadi `case.error`, tidak dihitung salah. 0 terskor → `error` |
| `src/app/api/evals/vlm/route.ts` | POST `{engine, model, setId, maxTokens}`: cek model dilayani dan `vision`, mulai run terlepas, balas `{runId}`. GET daftar run. `[id]` GET/DELETE |
| `src/modules/evals/components/vlm-eval.tsx` | Tab baru "Vision": pilih set dan model, progres, tabel kasus dengan thumbnail, jawaban model, kunci, dan skor; `Compare({a,b})` untuk base vs fine-tune pada set yang sama |

- `predict`: `POST {engine}/chat/completions` dengan gambar sebagai data URL (dibaca dari folder set), `temperature 0`, `max_tokens` kecil (default 256).
- Prompt diambil dari pesan `user` di baris set. Jawaban yang dinilai adalah teks asisten. Kunci diambil dari pesan `assistant` terakhir.
- Tes: skor murni (banyak kasus tepi), runner dengan `predict` di-mock, route dengan store sementara.

### 6.2 Benchmark VL standar
- Trainer eval baru `trainers/lmms-eval-vlm/` (job TL `subtype:"EVAL"`) yang menjalankan `lmms-eval` terhadap **endpoint OpenAI-compatible** model yang dilayani (D12) **[verifikasi nama model type dan argumennya di versi lmms-eval yang di-pin]**.
- Tugas awal: `chartqa`, `docvqa_val`, `mmmu_val`, dan `ai2d` bila tersedia. Pakai `limit` kecil secara default, karena sesuai protokol E2E benchmark penuh tidak dijalankan rutin.
- `src/lib/benchmarks.ts`: tambah grup `vision` dengan metrik per tugas (bukan `acc` pilihan ganda). Sesuaikan `chance`/`questions`.
- Hasil dibaca seperti job lm-eval (`fetchEvalJobs`). Tab Compare dan Retention memakai metrik yang sesuai.
- **Retensi teks:** base VL yang di-fine-tune juga dicek di benchmark teks yang ada, supaya kemampuan teks tidak turun. Merge untuk lm-eval harus VL-aware (`rantai_merge.sh` cabang VL, Fase 5.3), atau pakai `peft=` tanpa merge.

**Gerbang Fase 6:**
- `latex-ocr-test` (300 baris, split test HF) menunjukkan `latex-ocr` > base di luar interval (exact) dan CER turun.
- `chartqa-test` (300 baris) menunjukkan skor `latex-ocr` tidak turun di luar interval dibanding base.
- Satu benchmark VL dengan `limit` kecil berhasil di box.
- `eval.vlmTestSet` dan `eval.vlmBenchmark` → `live`.

---

## Fase 7 — Export GGUF VL (opsional)

Kerjakan hanya bila ada kebutuhan CPU/Edge untuk model VL.

1. **[verifikasi]** Cek apakah `convert_hf_to_gguf.py` di llama.cpp terbaru mendukung arsitektur base kita beserta `--mmproj`. Qwen3-VL dan Gemma-3 sudah didukung di beberapa versi; SEA-LION turunan perlu dicek.
2. Cabang VL di `scripts/serve/rantai_export_gguf.sh`:
   - merge dengan `AutoModelForImageTextToText` dan simpan processor;
   - konversi model bahasa (q8_0) dan proyektor (`--mmproj`, f16);
   - tes dengan `llama-mtmd-cli` (atau binari multimodal versi tersebut) pada satu gambar.
3. Ollama: **[verifikasi]** cara memasang proyektor di Modelfile pada versi Ollama box. Kalau tidak didukung, sediakan jalur `llama-server --mmproj` saja.
4. UI export: tampilkan opsi hanya untuk arsitektur yang lolos langkah 1; selain itu beri pesan "belum didukung llama.cpp".

**Gerbang:** model GGUF VL menjawab gambar di CPU (llama.cpp). `export.ggufVision` → `live`, atau tercatat "tidak didukung" beserta alasannya.

---

## Fase 8 — Uji end-to-end, dokumen, rilis

1. **E2E**
   - `scripts/e2e.js`, area baru "vision":
     - chat bergambar (bila engine vision tersedia);
     - 413 untuk body besar;
     - 400 untuk model non-vision;
     - `GET /api/chat-images/<sha jahat>` → 400.
   - Tulis-baca dataset vision di `scripts/e2e-write.js` (dengan izin dan pembersihan).
   - Playwright `tests/vision.spec.ts`: lampirkan gambar dan kirim; pratinjau ZIP; tab eval Vision tampil.
   - `tests/api-surface.spec.ts`: semua route baru → 401 tanpa login.
2. **Dokumen**
   - `docs/UJI-END-TO-END.md`: bagian baru dengan format yang ada (ringkasan, bug, tabel per area, kasus tepi).
   - `docs/ARSITEKTUR.md`:
     - perbaiki versi Next (16);
     - tambah bagian "Gambar dan VLM": format konten, penyimpanan gambar chat, dataset vision, trainer vision, batas engine, eval vision;
     - tambah ke "Jebakan" bila ada temuan baru.
   - `docs/ROADMAP.md`: pindahkan VLM ke "Yang sudah selesai" dengan versi rilis.
   - README: satu paragraf fitur.
3. **Rilis**
   - Versi minor baru (mis. v0.44.0).
   - Image frontend lewat alur rilis yang biasa.
   - Deploy ke box dengan izin pengguna, cadangan container lama seperti `rantai-frontend-old`.
   - Flag batas multimodal di produksi dinyalakan hanya atas keputusan pengguna.

---

## Urutan dan perkiraan

| Fase | Bergantung pada | Ukuran | Bisa paralel dengan |
|---|---|---|---|
| 0 Verifikasi | — | 0,5–1 hari | — |
| 1 Fondasi | 0 | 0,5 hari | — |
| 2 Playground + serving | 1 | 2–3 hari | 3 |
| 3 Dataset | 1 | 3–4 hari | 2 |
| 4 Trainer | 3 (format), 0.7 | 3–5 hari | 6.1 |
| 5 Serving adapter | 4 | 1–2 hari | 6.2 |
| 6 Eval | 2 (jalur chat), 3 (format) | 3–4 hari | 4, 5 |
| 7 GGUF VL | 5 | 1–3 hari, opsional | — |
| 8 E2E + rilis | semua | 1–2 hari | — |

Demo tercepat ke atasan: selesai Fase 2, yaitu Playground bisa bertanya dengan gambar ke SEA-LION VL.

---

## Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Token gambar memenuhi konteks 8192 | Jawaban terpotong, request ditolak | Perkecil di browser (D2), batas engine (D5), tampilkan jumlah token prompt di metrik chat |
| Memori habis saat training 8B VL | Mengganggu produksi | Aturan memilih base di 0.7 (sisa ≥ 8 GB, kalau tidak pakai 4B), `device_map={"":0}`, batch 1, gradient checkpointing, watchdog 4 GB, jam sepi |
| Restart vLLM produksi untuk batas gambar | RantAI Agents terputus ±2–3 menit; adapter hilang | Prosedur Fase 2.4: jam sepi, container `-old` sebagai jalur kembali, cek 4 adapter dan gateway sesudahnya |
| Base sudah bagus di LaTeX_OCR | Demo tidak menunjukkan perbedaan | Ukur dulu di 0.10; ganti dataset bila base > 80% exact |
| LoRA vision tower tidak didukung engine | Adapter tidak bisa dilayani | Default lapisan bahasa saja (D10), filter dan peringatan di SGLang, jalur merge |
| Versi transformers/unsloth tidak cocok dengan base | Trainer gagal | Verifikasi 0.7 sebelum Fase 4, pin versi persis |
| Base64 di riwayat membuat Playground berat | UI lambat | Penyimpanan rujukan (D3) |
| SSRF lewat URL gambar | Engine mengakses jaringan internal | Hanya data URL dan `https://` publik di chat (1.1); di dataset, URL diunduh di trainer dengan timeout dan batas ukuran |
| Unggahan ZIP besar gagal di tengah | Dataset setengah jadi | Unggah per batch, bersihkan saat batal atau gagal, validasi ulang di server |
| Template chat VL berbeda dari teks (flag thinking) | Jawaban aneh atau `<think>` bocor | Verifikasi 0.8, kwarg per base |

---

## Keputusan pengguna (6 November 2026)

Jawaban atas pertanyaan terbuka versi pertama dokumen ini:

| # | Pertanyaan | Jawaban | Dampak ke rencana |
|---|---|---|---|
| 1 | Inference saja atau sampai training bergambar? | Sampai training dengan data bergambar | Fase 0–6 wajib, 7 opsional |
| 2 | Kasus pakai pertama? | Tidak harus RantAI Agents; yang penting fitur jalan dan bisa didemokan | Skenario demo di §3b |
| 3 | Dataset internal? | Tidak ada; pakai open source | LaTeX_OCR (utama) + ChartQA (retensi), §3b |
| 4 | Base prioritas? | 8B VL bila muat, 4B VL bila tidak | Aturan di Fase 0.7 |
| 5 | Batas multimodal di produksi boleh? | Boleh | Prosedur restart di Fase 2.4 |

Sisa hal yang masih perlu ditanyakan ke pengguna saat eksekusi:
- Jam sepi untuk restart `rantai-vllm-8b` (Fase 2.4) dan untuk training 8B (Fase 0.7, Fase 4).
- Izin deploy frontend versi baru ke box di akhir Fase 2, 3, dan 6 (untuk uji di box).

---

## Lampiran: template prompt per fase

Contoh prompt untuk menjalankan satu fase dengan Claude Code (Sonnet):

```
Baca docs/RENCANA-VLM.md bagian "1. Aturan kerja", "2. Peta kondisi sekarang",
"3. Keputusan desain", lalu kerjakan Fase <N> saja.
- Cek ulang nomor baris yang disebut sebelum mengedit; kode bisa sudah berubah.
- Hal bertanda [verifikasi]: cek dulu di dokumentasi/source versi yang di-pin, jangan menebak.
- Tulis tes lebih dulu untuk fungsi murni, jalankan vitest/pytest yang relevan sampai lulus.
- Jangan sentuh container produksi; untuk uji di box minta izin saya dulu.
- Catat di AI_KNOWLEDGE_LOG.md. Jangan commit/push sebelum saya minta.
- Akhiri dengan ringkasan: yang selesai, gerbang fase lulus/tidak, sisa pekerjaan.
```
