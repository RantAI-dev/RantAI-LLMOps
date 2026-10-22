# Trainers

Task scripts that Transformer Lab clones and runs for a training job.

## Why these live here

Transformer Lab launches a training job by cloning `github_repo_url` and running
`github_repo_dir`. Upstream, `src/lib/finetune.ts` pointed that at
`transformerlab/transformerlab-app` — so the code that actually trained our models
was not ours, and its defaults could not be changed from our side.

Three of those defaults were wrong for a DGX Spark (GB10, `sm_121`) and all three
failed *silently*:

| Upstream default | Why it hurt |
|---|---|
| `load_in_4bit=True` (hardcoded) | 4-bit buys nothing against 128 GB unified memory, adds compute, and bitsandbytes' 4-bit kernels are reported to stall on `sm_121` |
| `optim="adamw_8bit"` | also routes the hot path through bitsandbytes |
| dataset load falls back to a 3-row placeholder | a wrong dataset id finished green having trained on nothing real |

So the trainer moved here, where we own the defaults. Since this repo is public,
Transformer Lab can still clone it without credentials.

`eleutherai-lm-evaluation-harness/` is here for the same reason. Upstream built
`--model_args` without naming a dtype, so weights loaded as fp16 while Apertus'
xIELU activation builds its parameters in bf16. Mixing the two promotes to fp32
and the next `Linear` rejects its own input:

```
RuntimeError: expected mat1 and mat2 to have the same dtype, but got: float != c10::Half
```

Every Apertus benchmark died there, before scoring a single sample.

## Keeping it diffable

`unsloth-llm-train/` is a fork of
[`api/transformerlab/galleries/examples/unsloth-llm-train`](https://github.com/transformerlab/transformerlab-app/tree/main/api/transformerlab/galleries/examples/unsloth-llm-train).
It is kept structurally identical to upstream so changes can be diffed and pulled
forward; every deviation is listed in the module docstring at the top of
`train.py`. Add new deviations to that list.

The vendored copy under `backend/transformerlab/galleries/examples/` mirrors
upstream and is **not** what runs — treat it as the diff baseline.

## Gotcha: the default branch

Transformer Lab clones the repo's **default branch**. A trainer edit only takes
effect once it is merged and pushed to `main` — running a job from a feature
branch still gets `main`'s copy.

## `unsloth-decision-train/` (decision models)

Trains **decision models** (System One / Jev-style): a language model plus a Clef decision head that
scores typed questions (`noul`, `choice`, `score`) and returns an answer with a calibrated
probability instead of writing text. Built on Unsloth's `FastDecisionModel` / `DecisionTrainer`
(AGPL-3.0, `unsloth/models/decision.py`). Validated on the GB10 on 2026-10-22 with Qwen3.5-0.8B,
SEA-LION 8B (4-bit) and SEA-LION 4B (4-bit); see `AI_KNOWLEDGE_LOG.md`.

- Row format and validation: `decision_schema.py` (tests: `python test_decision_schema.py`).
- Outputs: an adapter + head under the model name `unsloth_decision_model` (deliberately not
  `unsloth_trained_model`, so chat-LoRA tooling never picks it up), `decision_report.json`
  (before/after accuracy, ECE, record accuracy), `eval_predictions.jsonl`; optional merged 16-bit
  weights and a GGUF (Qwen3.5 backbones only).
- Loss lines are printed as `{'loss': x, 'step': n}` on purpose: transformers 5 prints numbers as
  strings, which the UI's loss chart cannot parse. Never print an evaluation metric called `loss`
  as a dict, it would show up as a training-loss point.
- Try a branch before merging: set `DECISION_TRAINER_BRANCH=<branch>` on the frontend; the launch
  passes `github_repo_branch` (the backend supports it, the SFT trainers just never use it).
