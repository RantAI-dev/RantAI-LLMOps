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

### Status 18 Nov

- **D1** selesai (v0.46.0).
- **D2** tab *Compare strategies* di `/duo` (v0.47.0): pilih dataset, jumlah soal, dan strategi (`fast_only`,
  `slow_only`, `nafs_aql`, `nafs_aql_l05/l10/l40/l60`), jalankan eval gateway (`/api/duo/evals`), lalu lihat akurasi
  (interval 95%) terhadap detik per soal dengan frontier Pareto dari gateway. GSM8K (60 soal, GB10): System 1 81,7% /
  3,0 s, gate 98,3% / 12,0 s, System 2 98,3% / 32,6 s, jadi gate menyamai System 2 dengan 37% waktunya.
  **HumanEval belum bisa dinilai:** pemeriksa kode gateway menolak menjalankan kode karena sandbox (user/mount/PID
  namespace) tidak tersedia di kontainer `rantai-aql`; semua jawaban tercatat salah (fail closed). Perlu kontainer
  dengan `seccomp=unconfined` dan `apparmor=unconfined`, mungkin juga `kernel.apparmor_restrict_unprivileged_userns=0`
  di host. Menunggu keputusan.
- **D3** tertahan: frontend production tidak memasang Docker socket. Gateway menunjuk alias tetap (`aql-s1:8001`
  `system1`, `aql-s2:8002` `system2`), jadi D3 cukup mengganti kontainer di balik alias itu tanpa menulis ulang
  konfigurasi gateway.
- **D4** butuh keputusan: Tazkiya meminta ≥ 5.000 jawaban System 2 terverifikasi (±20 jam GPU di GB10, berbagi dengan
  model UGM); pilot kecil 300–500 soal dimungkinkan.
- **D5** belum dimulai (strategi baru di `nafs-eval`, Rust).

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
