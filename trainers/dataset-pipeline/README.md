# dataset-pipeline — Corpus PDF → SFT JSONL

Turns school-book PDFs in MinIO into an instruction dataset (`prompt`/`completion`
JSONL) ready to fine-tune. Runs as a **Transformer Lab task** (same clone-and-run
pattern as `../unsloth-llm-train`), orchestrated from the Next.js app exactly like
a fine-tune job: submit → poll `progress.json` → done.

Adapted from the reference pipeline that built dataset **v3** (~6.7k rows). Every
stage is **deterministic and resumable** except stage 5 (teacher-AI), which is
resumable via its own checkpoint.

## Stages & contract (everything is JSONL, easy to pipeline)

| # | Stage | Input | Output | Needs |
|---|-------|-------|--------|-------|
| 1 | Catalog & triage | S3 listing + `*_metadata.json` | `manifest-clean.jsonl` + `catalog-full.csv` | — |
| 2 | Extract & chunk | PDF + manifest | `chunks.jsonl` | CPU (pymupdf) |
| 3 | Clean | `chunks.jsonl` | `clean_chunks.jsonl` | — |
| 4 | Refusals | `clean_chunks.jsonl` | `refusals.jsonl` + `pos_chunks.jsonl` | — |
| 5 | Positives (teacher) | `pos_chunks.jsonl` | `positives.jsonl` | Ollama/vLLM endpoint |
| 6 | Assemble | positives + refusals | `train.jsonl` + `eval.jsonl` | — |

**Phase 1** = stages 1–3 (CPU-only, no LLM). **Phase 2** = stages 4–6.

## S3 layout (under `s3://<bucket>/sft/<version>/`)

```txt
_pipeline/manifest-clean.jsonl     stage 1 — in-scope books
_pipeline/catalog-full.csv         stage 1 — every book + why included/excluded
_pipeline/chunks.jsonl             stage 2
_pipeline/clean_chunks.jsonl       stage 3
_pipeline/refusals.jsonl           stage 4
_pipeline/pos_chunks.jsonl         stage 4 — positives selected for stage 5
_pipeline/positives.jsonl          stage 5
_pipeline/progress.json            live job status (Next.js polls this)
train.jsonl                        stage 6 — final
eval.jsonl                         stage 6 — final
```

`train.jsonl`/`eval.jsonl` are `{ "prompt": ..., "completion": ... }` per line —
the exact shape `trainers/unsloth-llm-train/train.py` already consumes from an
`s3://` reference, so a built dataset is trainable with zero glue.

## Record shapes

- **manifest-clean.jsonl** — `{ pdf_key, kb, jenjang, class, subject, book_type, title }`
- **chunks.jsonl / clean_chunks.jsonl** — `{ chunk_id, kb, source{title,jenjang,kelas,subject,book_type,bab,page_start,page_end}, chunk_type, approx_tokens, text }`
- **refusals.jsonl / positives.jsonl / train.jsonl / eval.jsonl** — `{ prompt, completion }`

## progress.json (the job status the UI reads)

```jsonc
{
  "version": "v3",
  "updated": "<iso>",
  "stages": {
    "1": { "status": "done",    "counts": { "total": 1421, "in_scope": 914 } },
    "2": { "status": "running", "counts": { "books": 156, "chunks": 12030 } },
    "3": { "status": "pending" }
  }
}
```

`status` ∈ `pending | running | done | error`. Each stage writes it after every
book / checkpoint so the wizard can render a live progress + quality report.

## Run

Driven by `task.yaml` parameters (`bucket`, `pdf_prefix`, `version`, `stages`, …).
`run.py` dispatches the requested stages in order; a stage skips work already on
S3 unless `force` is set. See each `stage*.py` for the algorithm.
