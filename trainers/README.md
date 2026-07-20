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
