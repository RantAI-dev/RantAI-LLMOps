# Demo VLM (±10 menit) — naskah dan persiapan

Untuk yang mendemokan. Skenario ringkas ada di `RENCANA-VLM.md` §3b; ini versi yang sudah dilatih ulang di box
(7 Nov 2026), dengan angka yang benar-benar terukur dan hal yang jangan diklaim.

## Angka yang boleh disebut (4B VL, 300 soal uji yang tidak dipakai training)

| Set uji | Base | 1 epoch (`tl-full`) | 3 epoch (`tl-3ep`) |
|---|---|---|---|
| LaTeX_OCR, exact match | 0,7% | 14,3% | **16,0%** |
| LaTeX_OCR, CER (makin kecil makin baik) | 0,417 | 0,236 | **0,198** |
| ChartQA (kemampuan umum, harus tidak turun) | 57,7% | 61,7% | **62,7%** |

Training lewat Transformer Lab dari UI/API frontend: `tl-full` 2.000 contoh, 1 epoch, 32 menit (job `f0dfde75…`); `tl-3ep` data
sama, 3 epoch, 103 menit (job `f30b0145…`). Galat standar exact match ±2 poin, jadi selisih 14,3% → 16,0% belum bisa dibilang nyata;
yang jelas membaik adalah CER (0,236 → 0,198). Pada `tl-3ep` loss latih turun ke 0,07 sementara loss eval hanya 0,248 → 0,239:
tanda mulai menghafal, jadi lebih epoch bukan jalan keluar. Jalur skrip lama (1 epoch) memberi 15,0% / 0,224, konsisten.
Ini bukti fitur bekerja, **bukan** model yang siap pakai: 16% itu rendah untuk produksi. Peningkatan nyata butuh data lebih banyak dan
beragam (LaTeX_OCR punya puluhan ribu baris; yang dipakai 2.000), bukan lebih banyak epoch.

## Jangan diklaim

- Fine-tune di 8B VL (tidak muat di memori box; yang dilatih 4B).
- Export GGUF untuk VL (belum terbukti, lihat `UJI-END-TO-END.md` §9).
- Skor benchmark VL standar (MMMU dan sejenisnya tidak dijalankan).
- Adapter vision yang dilayani SGLang: SGLang menolak adapter yang menyentuh vision tower (alasannya tampil di pesan).

## Persiapan (30–40 menit sebelum)

1. Pastikan tidak ada job GPU lain. Memori host harus punya ≥ 20 GiB bebas.
2. Portainer → nyalakan kontainer `vllm4b-tl` (Gemma-SEA-LION 4B VL + adapter `latex-ocr`, `tl-full`, `tl-3ep`; siap ±2 menit,
   memakai ±13 GB RAM). Kalau kontainer tidak ada, buat dari `vllm4b-test` dengan tambahan mount volume
   `rantai-llmops_tl_data` ke `/tl` dan `VLLM_LORA_MODULES` yang menunjuk ke folder adapter job.
3. Nyalakan `rantai-frontend-vlm` (http://10.17.254.27:3010, password sama dengan UI produksi). Ia menunjuk ke
   `vllm4b-tl`. UI produksi (http://10.17.254.27:3000) menunjuk ke vLLM 8B VL dan tidak berubah.
4. Siapkan file: `~/vlm-demo/latex-ocr-train.zip`, `~/vlm-demo/latex-ocr-test.zip`, ZIP rusak dari
   `scripts/vlm/make_fixture_zip.py --broken rusak.zip`, dan satu foto grafik atau rumus.
5. Buka dua tab: :3000 (Playground model produksi) dan :3010 (semua yang lain).

## Alur

1. **Playground, :3000 (1 menit).** Pilih vLLM, model `base`, klik ikon gambar, lampirkan foto grafik, tanyakan isinya.
   Pesan: model SEA-LION produksi sudah bisa melihat, lewat LLMOps.
2. **Datasets, :3010 (2 menit).** Add dataset → Vision → ZIP kecil (fixture 25 baris): pratinjau thumbnail, validasi lolos.
   Lalu ZIP rusak: ditolak dengan alasan. Unggahan 2.000 gambar makan ±11 menit, jadi dataset `vlm-e2e-latex-train`
   sudah disiapkan di workspace; tunjukkan itu.
3. **Fine-tune → Vision, :3010 (2 menit).** Tunjukkan form (base default Gemma-SEA-LION 4B VL, dataset, pilihan lapisan
   vision). Training penuh 32 menit, jadi tunjukkan job `vlm-latex-tl` yang sudah selesai: kurva loss 3,0 → ±0,25.
   Kalau mau live: job 10 langkah selesai ±5 menit setelah dikirim, tapi hasilnya belum belajar (jangan dievaluasi).
4. **Deployments, :3010 (1 menit).** vLLM menyajikan `base`, `latex-ocr`, `tl-full`, `tl-3ep`, masing-masing berlabel Vision.
5. **Evals → Vision, :3010 (2 menit).** Run history sudah berisi base vs adapter. Tunjukkan exact match dan CER, lalu
   ChartQA sebagai bukti kemampuan umum tidak rusak. Run baru 300 soal makan ±9 menit, jadi jangan dijalankan live.
6. **Playground, :3010 (1 menit).** Lampirkan gambar rumus dari `latex-ocr-test.zip`, tanya ke `base`, lalu ke `tl-full`
   (chat baru tiap model; pakai `tl-3ep`). Jawaban adapter lebih dekat ke format referensi.
7. **Gateway (1 menit).** Satu `curl` ke gateway dengan API key dan gambar sebagai bukti siap dipakai aplikasi lain.

## Kalau macet

- Respons pertama lambat (ttft beberapa detik): normal, kompilasi pertama.
- Playground menolak gambar: model yang dipilih terdaftar teks-saja di Ollama (pilih vLLM).
- vLLM "Unreachable" di Deployments: kontainer `vllm4b-tl` belum siap atau mati karena memori. Cek log di Portainer.
- Lebih dari 2 gambar per pesan ditolak di :3010 (batas `--limit-mm-per-prompt`). Di UI dibatasi 4 per pesan.

## Setelah demo

Hentikan `vllm4b-tl` dan `rantai-frontend-vlm` (membebaskan ±13 GB RAM dan GPU). Hapus percakapan uji dari Playground.
