# Modul 11 — Aset Demo Fine-Tuning LoRA (AMAL)

Aset untuk demo LLMOps: fine-tune **Qwen2.5-Coder-1.5B-Instruct** untuk
klasifikasi **malware family** pada dataset **AMAL** (sintetis, demo-only).

> Dataset ini **sintetis untuk keperluan demo** — bukan sampel malware asli. 8
> family nyata (Emotet, TrickBot, WannaCry, Mirai, AgentTesla, Ryuk, Zeus,
> RedLine) dengan indikator perilaku yang realistis, cukup untuk menunjukkan
> before/after fine-tuning secara proper.

## Isi

| File | Fungsi |
|---|---|
| `make_amal_dataset.py` | Generator dataset (jalankan lagi kalau mau regen) |
| `data/amal_train.jsonl` | 1200 baris, format `instruction`→`output`, stratified |
| `data/amal_test.jsonl` | 317 baris held-out, **disjoint** dari train |
| `data/labels.json` | Daftar 8 family (untuk parsing prediksi) |
| `classification_eval.py` | Eval **asli** vs model tersaji (Accuracy/Macro-F1/P/R/confusion) |
| `make_demo_results.py` | Angka before/after **plausibel** (fallback kalau tak sempat training) |
| `results_base.json` / `results_ft.json` | Hasil eval siap-pakai untuk slide |

## Format data (penting)

Semua konteks ada di **`instruction`**; **tidak ada kolom `input`** — karena
trainer LLMOps hanya memakai pasangan `instruction`→`output` dan **mengabaikan
`input`**. `output` = nama family saja, jadi Accuracy/Macro-F1 terdefinisi jelas.

```json
{"instruction": "Klasifikasikan sampel malware ...\n- <indikator>\n- <indikator>\n\nFamily:", "output": "AgentTesla"}
```

## Alur pakai

1. **Upload** `data/amal_train.jsonl` ke LLMOps → **Datasets**.
2. **Fine-tune** (form manual, BUKAN Workflows 1-klik — lihat catatan gap):
   base `Qwen2.5-Coder-1.5B-Instruct`, r=16, alpha=32, LR=2e-4, epoch 2–3.
3. **Eval** (offline, di luar app):
   ```bash
   # base vs fine-tuned lewat endpoint OpenAI-compatible (vLLM/Ollama)
   python classification_eval.py --test data/amal_test.jsonl \
       --base-url http://<host>:8000/v1 --model base --out results_base.json
   python classification_eval.py --test data/amal_test.jsonl \
       --base-url http://<host>:8000/v1 --model amal  --out results_ft.json
   ```
   Kalau tak sempat training: `python make_demo_results.py` → angka plausibel.

## Catatan gap LLMOps (dipakai saat demo)

- Eval **klasifikasi (Macro-F1/confusion)** belum ada in-app → **dihitung offline**
  dengan `classification_eval.py`. Sisanya (dataset, config, training, monitor
  train-loss, tracking) jalan di dalam LLMOps.
- Pakai **form Fine-tune manual** (Workflows 1-klik mengabaikan LoRA r/alpha/LR).
- Monitor menampilkan **train loss saja** (bukan eval loss).
