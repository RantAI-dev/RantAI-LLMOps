# Rencana — Duo (System 1 + System 2) di LLMOps

> Ditulis 16 November 2026. Permintaan Pak Risman (WA 14 Nov, weekly 15 Nov): Nafs-Aql siap diuji dan dipercepat di
> DGX; di LLMOps harus bisa **serve** System 1 dan System 2, **fine-tune** keduanya, dan ada **Playground** tempat
> keduanya bekerja sama, memakai Nafs-Aql sebagai alat uji ("semantic duo inferences").

## 1. Konsep

Dua model bekerja sama: **System 1** kecil dan cepat menjawab lebih dulu, **System 2** model reasoning dipanggil
hanya bila perlu. Ada dua cara memutuskan "perlu", dan keduanya akan bisa dibandingkan di LLMOps:

| | Nafs-Aql (`RantAI-dev/Rantai-Aql`) | vLLM Semantic Router ("When to Reason", arXiv 2510.08731) |
|---|---|---|
| Kapan memutuskan | **sesudah** System 1 membuat draf | **sebelum** menjawab, dari teks pertanyaan |
| Alat | gate ambang (naik bila error yang dihemat ≥ biaya tunggu, satu parameter λ), checker untuk tugas yang bisa diperiksa (matematika, kode, skema), sampel kesepakatan | classifier ModernBERT (kategori, PII, jailbreak) di filter Envoy |
| Model | dua model berbeda (Qwen3-1.7B dan Qwen3-4B-Thinking) | satu model, reasoning dinyalakan/dimatikan |
| Hasil yang diklaim | biaya 36% dari "selalu berpikir" pada akurasi sama (6 tugas, CPU 4 core) | MMLU-Pro: akurasi +10,2 poin, latensi −47%, token −48,5% |
| Label ke pengguna | Checked / Cross-checked / Not checked | tidak ada |

## 2. Yang sudah ada (16 Nov)

- **Rantai-Aql jalan di box GB10** (`deploy/gb10` di repo Rantai-Aql): `aql-s1` (Qwen3-1.7B) dan `aql-s2`
  (Qwen3-4B-Thinking) di vLLM GPU, gateway Rust di port 8096 dengan token.
- **LLMOps**: serve vLLM/SGLang/Ollama, fine-tune (trainer teks dan vision), Playground (Interact), model keputusan
  System One, eval.
- **Belum ada**: orkestrasi dua model, gate, dan tampilan jejak di LLMOps; ShadowPrefill di jalur GPU (engine Smiley
  Core Nafs-Aql hanya punya kernel AVX2, di ARM jatuh ke skalar).

### Status 19 Nov (dijeda; fokus pindah ke UGM)

- **D1** selesai (v0.46.0).
- **D2** selesai (v0.47.0, perbaikan crash pindah tab di v0.48.0). Tab *Compare strategies* di `/duo`: pilih dataset,
  jumlah soal, dan strategi, jalankan eval gateway (`/api/duo/evals`), lalu lihat akurasi (interval 95%) terhadap detik
  per soal dengan frontier Pareto. Hasil di GB10:
  - GSM8K 60 soal: System 1 81,7% / 3,0 s, gate 98,3% / 12,0 s, System 2 98,3% / 32,6 s. Gate menyamai System 2 dengan
    37% waktunya.
  - schema_tasks: System 1 91,7% / 0,8 s, gate 100% / 0,9 s, System 2 100% / 24,2 s.
  - Sapuan λ di GSM8K (30 soal): System 1 93,3% / 2,8 s; semua λ (0,05–0,60) 100% dengan 7,9–8,9 s dan eskalasi 13%.
  - **Dataset kode (HumanEval) dilewati.** Sandbox pemeriksa kode butuh user namespace, yang ditolak host Ubuntu 24.04
    (`kernel.apparmor_restrict_unprivileged_userns=1`). Keputusan: pengaturan host tidak diubah.
- **D3** live (v0.49.0). Tab *Models* mengganti model atau adapter System 1/2 lewat kontainer terpisah
  `rantai-duo-deployer` yang memegang Docker socket (tanpa port ke host, hanya status/deploy/rollback dengan token);
  frontend tetap tanpa socket. Celah: daftar adapter hasil training di tab itu masih kosong (host-runner belum
  tersambung), jadi saat ini hanya ganti model dasar.
- **D4 pilot tidak lolos gerbang.** 293 jawaban System 2 terverifikasi dari GSM8K train, LoRA r16 pada Qwen3-1.7B,
  2 epoch (job `4a0286bd`). Dibandingkan System 1 tanpa adapter pada 60 soal yang sama (run 18 Nov):
  System 1 turun dari 86,7% ke 73,3% (2,8 → 2,7 s); gate tetap 98,3% tapi eskalasi naik dari 20% ke 30% dan waktu
  naik dari 13,7 ke 16,4 s. Adapter tidak dipakai; `aql-s1` dikembalikan ke model dasar. Kemungkinan penyebab: data
  terlalu sedikit dan gaya jawaban System 2 (panjang, berpikir) tidak cocok untuk System 1 tanpa mode berpikir.
- **D4 ronde 2 juga tidak lolos.** System 1 menjawab 1.200 soal GSM8K train (950 benar); System 2 memperbaiki 221
  dari 250 yang salah; 1.392 baris (jawaban sendiri + perbaikan ×2) dengan system prompt asli gateway, 1 epoch,
  lr 1e-4 (job `20b2628c`). Hasil 60 soal: System 1 83,3% (baseline 86,7%, pilot 73,3%) tetapi 13,0 s per soal
  (baseline 2,8 s); gate 98,3% / 15,8 s, eskalasi 25%. Adapter tidak dipakai; `aql-s1` kembali ke model dasar.
  Penyebab lambat belum diperiksa (panjang data latih mirip). D4 dihentikan dulu.
- **D5** selesai (Rantai-Aql PR #1, strategi `pre_route`: System 1 memilih jalur sebelum menjawab).
  - GSM8K 60: fast 86,7% / 2,8 s; pre_route 86,7% / 8,8 s (eskalasi 8%); gate 98,3% / 13,7 s (20%); slow 98,3% /
    31,5 s.
  - schema_tasks: fast 91,7% / 0,83 s; pre_route 91,7% / 0,95 s; gate 100% / 3,2 s; slow 100% / 25,4 s.
  - Router sebelum menjawab tidak menambah akurasi. Gate yang memutuskan setelah melihat draf tetap terbaik.

## 3. Arsitektur

```
Browser ── /duo (halaman LLMOps)
             │  POST /api/duo/chat  {messages, mode, lambda}
             ▼
LLMOps BFF ── token Rantai-Aql hanya di server (DUO_GATEWAY_URL, DUO_GATEWAY_TOKEN)
             │  POST /v1/chat
             ▼
Rantai-Aql gateway ── gate, checker, judge, memori
     │                         │
     ▼                         ▼
 aql-s1 (System 1)        aql-s2 (System 2)        ← dilayani vLLM; nanti adapter hasil fine-tune LLMOps
```

LLMOps tidak menulis ulang gate. Gateway Rantai-Aql adalah orkestratornya; LLMOps menyediakan model, adapter, UI, dan
eval di sekitarnya. Dengan begitu pembaruan Nafs-Aql dari Pak Risman tetap bisa diambil lewat `upstream`.

## 4. Tahapan

| Tahap | Isi | Gerbang |
|---|---|---|
| **D1** Halaman Duo (prototipe) | `/api/duo/chat` (BFF) dan halaman `/duo`: pilihan Auto / Cepat / Teliti, slider λ, jawaban dengan label, panel jejak (draf System 1, keputusan gate, panggilan checker, System 2, waktu tiap tahap, token) | Satu pertanyaan mudah tetap di System 1, satu soal sulit naik ke System 2, keduanya tampil dengan jejaknya; token tidak pernah sampai ke browser |
| **D2** Perbandingan strategi | Jalankan eval Rantai-Aql (`nafs_aql`, `fast_only`, `slow_only`, `nafs_aql_l<λ>`) dari halaman Evals; tampilkan akurasi vs biaya per strategi | Kurva akurasi–biaya tampil untuk GSM8K dan HumanEval |
| **D3** Deploy pasangan dari LLMOps | Kartu "Duo" di Deployments: pilih model/adapter System 1 dan System 2, LLMOps menyalakan dua vLLM dan menulis konfigurasi gateway | Pasangan baru bisa dinyalakan tanpa Portainer |
| **D4** Fine-tune System 1 / System 2 | Data dari label gate Rantai-Aql (`[labels]`) dan set distilasi (`training/tazkiya`), dilatih dengan trainer LLMOps sebagai LoRA, disajikan di `aql-s1`/`aql-s2` | Gate yang sama dengan adapter baru: akurasi sama atau naik dengan biaya lebih rendah |
| **D5** Strategi "sebelum menjawab" | Classifier ala Semantic Router (bisa memakai model System One LLMOps) sebagai strategi kedua di D2 | Dibandingkan pada set yang sama |

## 5. Risiko dan pertanyaan terbuka

- **"Peregrine"** belum jelas (engine atau model); ditanyakan ke Pak Risman.
- **ShadowPrefill** tidak ada di jalur GPU. vLLM punya prefix caching; padanannya (membaca percakapan lebih dulu di
  model yang menganggur) bisa ditambahkan di gateway untuk backend vLLM.
- **Kalibrasi gate** dibuat di CPU; biaya tunggu di GPU jauh lebih kecil, jadi λ terbaik bisa bergeser. D2 yang
  menunjukkannya.
- **Kesepakatan bukan bukti**: uji 16 Nov, System 2 menjawab salah (60, seharusnya 14) dengan label consensus.
