#!/usr/bin/env python3
"""
Decision-model fine-tuning with Unsloth (`FastDecisionModel` + `DecisionTrainer`).

A decision model does not write text. It reads a `state`, scores the options of typed
questions (noul = yes/no, choice, score) and returns an answer with a probability. This
trainer turns an ordinary language model (Qwen3.5, SEA-LION, ...) into one: a fresh Clef
decision head on the backbone's last hidden states, LoRA on the language layers, soft-target
cross-entropy, and a temperature fitted on held-out rows so the probabilities are calibrated.
The chat ability of the model is NOT preserved: keep the original model for chat and serve
the decision model separately.

Sibling of `unsloth-llm-train` (same lab SDK wiring, same fail-loud rules); it is a separate
directory because Transformer Lab sparse-clones ONE directory per job, so it cannot import
from its sibling. The dataset loader below is therefore a copy, minus the Hugging Face
`datasets` path: decision rows hold dicts whose keys differ from row to row, which Arrow
cannot represent without inventing null entries, so rows are read as plain JSON lines.

Deviations / rules, in the spirit of the SFT trainer:

  1. A dataset that fails validation raises, naming the row and the question. More than 2 %
     invalid rows aborts the run; a few are dropped and counted in the report.
  2. A caught training error exits the process NON-ZERO, so the job is marked FAILED rather
     than a green run with no model.
  3. The model is pinned to one GPU (`CUDA_VISIBLE_DEVICES=0`), as in the SFT trainer.
  4. Loss lines are printed in the canonical `{'loss': 1.234}` form. transformers 5 prints
     numbers as strings (`'loss': '1.234'`), which the UI's loss chart did not parse.
  5. Evaluation is reported BEFORE and AFTER training on the same rows: accuracy, expected
     calibration error (ECE) and record accuracy (every question of a row correct). A model
     that trained but did not beat its random head is visible in the report.
  6. Outputs are an adapter + head by default (small, loaded back with
     `FastDecisionModel.from_pretrained`), saved under the model name `unsloth_decision_model`
     (NOT `unsloth_trained_model`, so nothing that lists chat LoRA adapters picks it up).
     `save_merged` and `export_gguf` are opt-in; GGUF only exists for Qwen3.5 backbones.

Dataset: `s3://bucket/prefix/` holding `train.jsonl` (+ optional `eval.jsonl`), an s3:// file,
an http(s) URL, a local file/directory, or a dataset uploaded through the LLMOps UI. When
`eval.jsonl` exists it is the test set and the holdout for calibration is cut from train;
otherwise the holdout is both calibration and test set (slightly optimistic, and the report
says so). Row format: see decision_schema.py.
"""

from unsloth import FastDecisionModel, DecisionTrainer  # noqa: I001  (Unsloth first)
import glob
import json
import math
import os
import random
import subprocess
import sys
import time
import traceback
import urllib.request
from datetime import datetime

from lab import lab
import torch
from transformers import TrainerCallback, TrainingArguments

from huggingface_hub import login

from decision_schema import validate_rows

if os.getenv("HF_TOKEN"):
    login(token=os.getenv("HF_TOKEN"))

MAX_INVALID_FRACTION = 0.02
MIN_ROWS = 20


class LabCallback(TrainerCallback):
    """Progress to Transformer Lab and canonical loss lines to stdout."""

    def __init__(self, first_pct: int, last_pct: int):
        self.first, self.last = first_pct, last_pct

    def on_train_begin(self, args, state, control, **kwargs):
        lab.log("🚀 Decision training started")

    def on_step_end(self, args, state, control, **kwargs):
        if state.max_steps and state.max_steps > 0:
            frac = min(1.0, state.global_step / state.max_steps)
            lab.update_progress(int(self.first + (self.last - self.first) * frac))

    def on_log(self, args, state, control, logs=None, **kwargs):
        if not logs:
            return
        # print, not lab.log: only stdout reaches the job's stdout.log, which the UI parses.
        for key in ("loss", "eval_loss"):
            if key in logs:
                try:
                    value = float(logs[key])
                except (TypeError, ValueError):
                    continue
                if math.isfinite(value):
                    print(f"{{'{key}': {value:.4f}, 'step': {state.global_step}}}", flush=True)
        if "loss" in logs:
            lab.log(f"Step {state.global_step}: loss={float(logs['loss']):.4f}")

    def on_train_end(self, args, state, control, **kwargs):
        lab.log("✅ Decision training finished")


# ─────────────────────────── dataset loading (rows, not Arrow) ───────────────────────────


def _read_jsonl(path: str) -> list:
    rows = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise RuntimeError(f"{os.path.basename(path)} line {n} is not valid JSON: {e}") from e
    return rows


def _pick_in_dir(directory: str, kind: str):
    """`<kind>.jsonl`, else the `*_<kind>.jsonl` a Transformer Lab upload leaves behind."""
    exact = os.path.join(directory, f"{kind}.jsonl")
    if os.path.exists(exact):
        return exact
    suffixed = sorted(f for f in os.listdir(directory) if f.endswith(f"_{kind}.jsonl"))
    return os.path.join(directory, suffixed[0]) if suffixed else None


def _upload_roots() -> list:
    roots = []
    workspace = os.getenv("_TFL_WORKSPACE_DIR") or ""
    if workspace:
        roots.append(os.path.join(workspace, "datasets"))
    here = os.path.abspath(__file__)
    marker = "/local_provider/local_provider_runs/"
    if marker in here:
        roots += sorted(glob.glob(os.path.join(here.split(marker, 1)[0], "orgs/*/workspace/datasets")))
    for base in ("/root/.transformerlab", os.path.expanduser("~/.transformerlab")):
        roots += sorted(glob.glob(os.path.join(base, "orgs/*/workspace/datasets")))
    seen = set()
    return [r for r in roots if not (r in seen or seen.add(r))]


def _load_rows(spec: str):
    """(train_rows, eval_rows_or_None) from any dataset reference the SFT trainer accepts,
    except Hugging Face hub ids (decision rows are not Arrow-friendly, see module docstring)."""
    local_dir = os.path.abspath("_dataset")
    os.makedirs(local_dir, exist_ok=True)

    if spec.startswith("s3://"):
        try:
            import s3fs
        except ImportError as e:  # pragma: no cover - depends on the job venv
            raise RuntimeError("An s3:// dataset needs the `s3fs` package — add it to the trainer setup.") from e
        endpoint = os.getenv("S3_ENDPOINT_URL") or os.getenv("AWS_ENDPOINT_URL")
        fs = s3fs.S3FileSystem(client_kwargs={"endpoint_url": endpoint} if endpoint else {})

        def _pull(remote):
            local = os.path.join(local_dir, os.path.basename(remote))
            lab.log(f"Pulling {remote} -> {local}")
            fs.get(remote, local)
            return local

        if spec.endswith("/"):
            train_local = _pull(f"{spec}train.jsonl")
            eval_remote = f"{spec}eval.jsonl"
            eval_local = _pull(eval_remote) if fs.exists(eval_remote) else None
        else:
            train_local, eval_local = _pull(spec), None
        lab.log(f"Dataset source: S3 ({endpoint or 'default endpoint'})")
        return _read_jsonl(train_local), (_read_jsonl(eval_local) if eval_local else None)

    if spec.startswith(("http://", "https://")):
        lab.log("Dataset source: HTTP URL")
        target = os.path.join(local_dir, "train.jsonl")
        urllib.request.urlretrieve(spec, target)  # noqa: S310 - the URL is the user's dataset reference
        return _read_jsonl(target), None

    if os.path.isdir(spec):
        train_file = _pick_in_dir(spec, "train")
        if not train_file:
            raise RuntimeError(f"Directory dataset '{spec}' has no train.jsonl or *_train.jsonl")
        eval_file = _pick_in_dir(spec, "eval")
        lab.log(f"Dataset source: local directory {spec} (train={os.path.basename(train_file)})")
        return _read_jsonl(train_file), (_read_jsonl(eval_file) if eval_file else None)

    if os.path.exists(spec):
        lab.log(f"Dataset source: local file {spec}")
        return _read_jsonl(spec), None

    if "/" not in spec:
        roots = _upload_roots()
        for root in roots:
            candidate = os.path.join(root, spec)
            if os.path.isdir(candidate):
                print(f"Dataset source: local upload {candidate}", flush=True)
                return _load_rows(candidate)
        print(f"No uploaded dataset matched {spec!r}; searched {roots}", flush=True)

    raise RuntimeError(
        f"Dataset {spec!r} was not found. Use an s3:// prefix with train.jsonl, an http(s) URL, a path, "
        "or a dataset uploaded through the UI (Hugging Face hub ids are not supported for decision rows)."
    )


# ─────────────────────────────────────── helpers ────────────────────────────────────────


def _fail(msg: str):
    lab.log(f"❌ {msg}")
    lab.error(msg)
    raise RuntimeError(msg)


def _checked_rows(rows: list, label: str) -> list:
    """Validate rows; drop a few invalid ones, abort on many (rule 1 in the docstring)."""
    valid, report = validate_rows(rows)
    lab.log(f"{label}: {report['valid']} valid of {report['total']} rows")
    for name, info in report["questions"].items():
        lab.log(f"  question {name!r} ({info['type']}): {info['rows']} labelled, labels {info['labels']}")
    if report["invalid"]:
        for line in report["errors"]:
            lab.log(f"  ⚠️  {line}")
    if report["total"] and report["invalid"] / report["total"] > MAX_INVALID_FRACTION:
        _fail(
            f"{label}: {report['invalid']} of {report['total']} rows are invalid "
            f"(limit {MAX_INVALID_FRACTION:.0%}). First problems: " + " | ".join(report["errors"][:3])
        )
    return valid


def _metrics(m: dict) -> dict:
    keep = ("accuracy", "ece", "loss", "record_accuracy")
    return {k: round(float(m[k]), 4) for k in keep if k in m and m[k] is not None and math.isfinite(float(m[k]))}


def _no_loss(m: dict) -> dict:
    """Metrics without the evaluation `loss` key (see _fmt: it would look like a training-loss point)."""
    return {k: v for k, v in m.items() if k != "loss"}


# Unsloth stages the converter from the unslothai/llama.cpp fork's releases, which has no b11443
# release (HTTP 404, checked 2026-10-22), so the export would fail. The upstream tag works.
LLAMA_CPP_TAG = os.getenv("DECISION_LLAMA_CPP_TAG", "b11443")


def _llama_cpp_for_gguf() -> str:
    """A ggml-org/llama.cpp checkout at LLAMA_CPP_TAG (convert_hf_to_gguf.py, conversion/clef.py and
    gguf-py/ with the decision keys), cloned into the job directory once."""
    pinned = os.getenv("UNSLOTH_LLAMA_CPP_SCRIPTS_DIR", "").strip()
    if pinned and os.path.isdir(pinned):
        return pinned
    target = os.path.abspath("_llama_cpp")
    if not os.path.isfile(os.path.join(target, "conversion", "clef.py")):
        lab.log(f"Cloning llama.cpp {LLAMA_CPP_TAG} for the GGUF converter")
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", LLAMA_CPP_TAG,
             "https://github.com/ggml-org/llama.cpp", target],
            check=True, timeout=300, capture_output=True,
        )
    return target


def _fmt(m: dict) -> str:
    """Metrics for a log line. Deliberately NOT a dict repr: the UI's loss chart picks up every
    `'loss': <number>` in the log, and an evaluation 'loss' printed that way becomes a fake
    training-loss point at the end of the curve."""
    names = {"accuracy": "accuracy", "ece": "ece", "record_accuracy": "record_accuracy", "loss": "eval_nll"}
    return " ".join(f"{names[k]}={m[k]}" for k in names if k in m)


def _rows_of(items: list, rows: list) -> list:
    return [rows[i] for i in sorted({it["row"] for it in items})]


def _write_predictions(model, processor, rows: list, path: str, limit: int) -> int:
    """One JSON line per row: its gold answers and the model's answers with probabilities."""
    written = 0
    with open(path, "w", encoding="utf-8") as f:
        for row in rows[:limit]:
            try:
                answers = FastDecisionModel.predict(model, processor, row["state"], row["questions"])
                out = {}
                for name, a in answers.items():
                    out[name] = {
                        "answer": a.get("answer"),
                        "confidence": a.get("confidence"),
                        "probabilities": a.get("probabilities"),
                    }
                record = {"gold": row.get("gold", row.get("answers")), "predicted": out}
            except Exception as e:  # one bad row must not lose the whole file
                record = {"gold": row.get("gold", row.get("answers")), "error": str(e)[:200]}
            state = row["state"] if isinstance(row["state"], str) else json.dumps(row["state"], ensure_ascii=False)
            record["state"] = state[:300]
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1
    return written


def train_decision():
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
    start = time.time()
    try:
        lab.init()
        config = lab.get_config()

        model_name = config.get("model_name", "unsloth/Qwen3.5-2B")
        dataset_spec = config.get("dataset", "")
        lr = float(config.get("lr", 1e-4))
        head_lr = float(config.get("head_lr", 3e-4))
        epochs = float(config.get("num_train_epochs", 1))
        max_steps = int(config.get("max_steps", -1))
        batch_size = int(config.get("batch_size", 4))
        grad_accum = int(config.get("gradient_accumulation_steps", 4))
        warmup_ratio = float(config.get("warmup_ratio", 0.05))
        weight_decay = float(config.get("weight_decay", 0.01))
        # 4096 is Clef's default context; CLINC-style questions with 150 options need it.
        max_seq_length = int(config.get("max_seq_length", 4096))
        lora_r = int(config.get("lora_r", 64))
        lora_alpha = int(config.get("lora_alpha", lora_r))
        lora_dropout = float(config.get("lora_dropout", 0.0))
        # Opt-in on purpose (GB10 has memory to spare), but 4-bit was validated on GB10:
        # SEA-LION 8B trains in 12.7 GB peak with bitsandbytes 0.50.
        load_in_4bit = bool(config.get("load_in_4bit", False))
        head_width = config.get("head_width") or None
        head_warmup_steps = int(config.get("head_warmup_steps", 0))
        label_smoothing = float(config.get("label_smoothing", 0.0))
        brier_weight = float(config.get("brier_weight", 0.0))
        kl_weight = float(config.get("kl_weight", 0.0))
        holdout_fraction = float(config.get("holdout_fraction", 0.1))
        predict_rows = int(config.get("predict_rows", 200))
        save_merged = bool(config.get("save_merged", False))
        export_gguf = bool(config.get("export_gguf", False))
        gguf_quant = str(config.get("gguf_quantization", "q8_0"))
        optim = config.get("optim", "adamw_torch")
        logging_steps = int(config.get("logging_steps", 5))
        seed = int(config.get("seed", 3407))

        if not dataset_spec:
            _fail("No dataset given. Set `dataset` to an s3:// prefix with train.jsonl, a path or an uploaded dataset.")

        settings = {
            "model_name": model_name, "dataset": dataset_spec, "lr": lr, "head_lr": head_lr,
            "num_train_epochs": epochs, "max_steps": max_steps, "batch_size": batch_size,
            "gradient_accumulation_steps": grad_accum, "warmup_ratio": warmup_ratio,
            "weight_decay": weight_decay, "max_seq_length": max_seq_length, "lora_r": lora_r,
            "lora_alpha": lora_alpha, "lora_dropout": lora_dropout, "load_in_4bit": load_in_4bit,
            "head_width": head_width, "head_warmup_steps": head_warmup_steps,
            "label_smoothing": label_smoothing, "brier_weight": brier_weight, "kl_weight": kl_weight,
            "holdout_fraction": holdout_fraction, "predict_rows": predict_rows, "save_merged": save_merged,
            "export_gguf": export_gguf, "gguf_quantization": gguf_quant, "optim": optim, "seed": seed,
        }
        lab.set_config({"experiment_name": "unsloth-decision-training", "model_name": model_name,
                        "dataset": dataset_spec, "_config": settings})
        lab.log(
            f"Decision training | base={model_name} | precision={'4-bit' if load_in_4bit else 'BF16'} | "
            f"seq={max_seq_length} | r={lora_r} | epochs={epochs} | head_lr={head_lr}"
        )
        out_root = os.path.abspath("./output")
        os.makedirs(out_root, exist_ok=True)

        # ── 1. data, validated before any GPU time is spent ──
        lab.log(f"Loading dataset: {dataset_spec}")
        try:
            train_rows, eval_rows = _load_rows(dataset_spec)
        except Exception as e:
            _fail(f"Dataset '{dataset_spec}' could not be loaded: {e}")
        train_rows = _checked_rows(train_rows, "train")
        if len(train_rows) < MIN_ROWS:
            _fail(f"Only {len(train_rows)} valid training rows; at least {MIN_ROWS} are needed.")
        if eval_rows is not None:
            eval_rows = _checked_rows(eval_rows, "eval") or None
        random.Random(seed).shuffle(train_rows)
        lab.update_progress(20)

        # ── 2. model ──
        lab.log(f"Loading {model_name} as a decision model")
        kwargs = {"head_width": int(head_width)} if head_width else {}
        model, processor = FastDecisionModel.from_pretrained(
            model_name, max_seq_length=max_seq_length, load_in_4bit=load_in_4bit, random_state=seed, **kwargs
        )
        lab.update_progress(35)

        # ── 3. tokenised items, holdout and test set ──
        items, build = FastDecisionModel.build_dataset(train_rows, processor, model)
        lab.log(f"Built {len(items)} items from {build['total']} rows (skipped {build['skipped']}, "
                f"truncated {build['truncated']}){' - ' + build['reason'] if build.get('reason') else ''}")
        if build["total"] and build["skipped"] / build["total"] > 0.05:
            _fail(f"{build['skipped']} of {build['total']} rows were skipped while tokenising "
                  f"({build.get('reason')}). Raise max_seq_length or shorten the rows.")
        if len(items) < MIN_ROWS:
            _fail(f"Only {len(items)} usable training items after tokenising.")
        train_items, holdout = FastDecisionModel.split_holdout(items, seed, fraction=holdout_fraction)
        test_items, test_rows, test_kind = holdout, _rows_of(holdout, train_rows), "holdout"
        if eval_rows:
            test_items, _ = FastDecisionModel.build_dataset(eval_rows, processor, model)
            test_rows, test_kind = eval_rows, "eval.jsonl"
        lab.log(f"Train items {len(train_items)}, holdout {len(holdout)}, test set {len(test_items)} ({test_kind})")
        if not test_items:
            _fail("The test set is empty: give an eval.jsonl or a larger holdout_fraction.")

        # ── 4. baseline (random head) ──
        lab.update_progress(40)
        base = _metrics(FastDecisionModel.evaluate(model, processor, test_items))
        lab.log(f"Before training on {test_kind}: {_fmt(base)}")
        lab.update_progress(45)

        # ── 5. train ──
        steps_per_epoch = max(1, math.ceil(len(train_items) / (batch_size * grad_accum)))
        total_steps = max_steps if max_steps > 0 else max(1, math.ceil(epochs * steps_per_epoch))

        def make_trainer(steps=None, num_epochs=None, pct=(50, 88)):
            n = steps or total_steps
            return DecisionTrainer(
                model=model, tokenizer=processor, train_dataset=train_items,
                head_learning_rate=head_lr, label_smoothing=label_smoothing, brier_weight=brier_weight,
                kl_weight=kl_weight, callbacks=[LabCallback(*pct)],
                args=TrainingArguments(
                    output_dir=os.path.join(out_root, "_run"),
                    per_device_train_batch_size=batch_size, gradient_accumulation_steps=grad_accum,
                    learning_rate=lr, lr_scheduler_type="cosine",
                    warmup_steps=max(1, round(warmup_ratio * n)), weight_decay=weight_decay,
                    max_steps=steps or (max_steps if max_steps > 0 else -1),
                    num_train_epochs=num_epochs or epochs, optim=optim,
                    bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
                    logging_steps=logging_steps, report_to="none", save_strategy="no", seed=seed,
                    dataloader_num_workers=0,
                ),
            )

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        if head_warmup_steps > 0:
            lab.log(f"Head warm-up: {head_warmup_steps} steps with the backbone frozen")
            FastDecisionModel.freeze_backbone(model)
            make_trainer(steps=head_warmup_steps, pct=(45, 50)).train()
            FastDecisionModel.unfreeze_backbone(model)
        model = FastDecisionModel.get_peft_model(model, r=lora_r, lora_alpha=lora_alpha,
                                                 lora_dropout=lora_dropout, random_state=seed)
        trainer = make_trainer()
        lab.update_progress(50)
        lab.log(f"Training {total_steps} steps ({steps_per_epoch}/epoch, effective batch {batch_size * grad_accum})")
        result = trainer.train()
        steps_done = trainer.state.global_step
        losses = [float(h["loss"]) for h in trainer.state.log_history if "loss" in h]

        # ── 6. calibrate on the holdout, evaluate on the test set ──
        lab.update_progress(90)
        calibration = {}
        if holdout:
            try:
                calibration = FastDecisionModel.calibrate(model, processor, holdout)
                lab.log(f"Calibrated on {len(holdout)} holdout items: "
                        f"{ {k: calibration[k] for k in ('accuracy', 'ece', 'fitted_types') if k in calibration} }")
            except Exception as e:  # too few items per question type is the usual reason
                lab.log(f"⚠️  Calibration skipped: {e}")
        tuned = _metrics(FastDecisionModel.evaluate(model, processor, test_items))
        lab.log(f"After training on {test_kind}: {_fmt(tuned)}")
        peak_gb = round(torch.cuda.max_memory_allocated() / 1e9, 2) if torch.cuda.is_available() else None

        # ── 7. outputs ──
        lab.update_progress(93)
        FastDecisionModel.for_inference(model)
        predictions = os.path.join(out_root, "eval_predictions.jsonl")
        n_pred = _write_predictions(model, processor, test_rows, predictions, predict_rows) if predict_rows > 0 else 0

        adapter_dir = os.path.join(out_root, "decision_model")
        model.save_pretrained(adapter_dir)
        lab.log(f"Saved adapter + head to {adapter_dir}")

        # Optional exports come AFTER the adapter is safe, and a failure here is recorded in the
        # report instead of raised: a trained model must not be written off because a GGUF
        # converter failed. The report says what happened, so a skipped export is not silent.
        exports = {}
        merged_dir = os.path.join(out_root, "decision_merged")
        if save_merged or export_gguf:
            try:
                model.save_pretrained_merged(merged_dir)
                exports["merged"] = {"status": "saved"}
                lab.log(f"Saved merged 16-bit model to {merged_dir}")
            except Exception as e:
                exports["merged"] = {"status": "failed", "error": str(e)[:300]}
                lab.log(f"⚠️  Merged save failed (the adapter itself is saved): {e}")
        if export_gguf and exports.get("merged", {}).get("status") == "saved":
            try:
                from unsloth.models.decision_gguf import export_decision_gguf, gguf_eligibility

                os.environ["UNSLOTH_LLAMA_CPP_SCRIPTS_DIR"] = _llama_cpp_for_gguf()
                eligibility = gguf_eligibility(merged_dir)
                if not eligibility["eligible"]:
                    exports["gguf"] = {"status": "skipped", "reason": eligibility["reason"]}
                    lab.log(f"⚠️  GGUF export skipped: {eligibility['reason']}")
                else:
                    info = export_decision_gguf(merged_dir, gguf_quant, print_output=True)
                    exports["gguf"] = {"status": "exported", "quantization": gguf_quant, "files": info.get("files")}
                    lab.log(f"GGUF export ({gguf_quant}) done: {info.get('files')}")
            except Exception as e:
                exports["gguf"] = {"status": "failed", "error": str(e)[:300]}
                lab.log(f"⚠️  GGUF export failed (the decision model itself is saved): {e}")

        report = {
            "kind": "decision-model", "base_model": model_name, "dataset": dataset_spec,
            "rows": {"train_valid": len(train_rows), "eval": len(eval_rows) if eval_rows else 0},
            "items": {"train": len(train_items), "holdout": len(holdout), "test": len(test_items),
                      "skipped": build["skipped"], "truncated": build["truncated"]},
            "test_set": test_kind,
            "test_set_note": ("calibration and test share the holdout (slightly optimistic)"
                              if test_kind == "holdout" else "test set is separate from calibration"),
            "before": base, "after": tuned,
            "calibration": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in calibration.items()},
            "temperatures": [round(float(t), 4) for t in model.decision_config.get("temperature", [])],
            "steps": steps_done, "epochs": epochs,
            "loss_first_last": [round(losses[0], 4), round(losses[-1], 4)] if losses else None,
            "train_runtime_s": round(result.metrics.get("train_runtime", 0.0), 1),
            "peak_gpu_gb": peak_gb, "predictions": n_pred, "exports": exports, "settings": settings,
            "wall_minutes": round((time.time() - start) / 60, 1),
            "completed_at": datetime.now().isoformat(),
        }
        report_path = os.path.join(out_root, "decision_report.json")
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        # A single greppable line, for anything that reads stdout.log rather than artifacts.
        print("DECISION_REPORT " + json.dumps({"before": _no_loss(base), "after": _no_loss(tuned), "test_set": test_kind}), flush=True)
        lab.save_artifact(report_path, "decision_report.json")
        if n_pred:
            lab.save_artifact(predictions, "eval_predictions.jsonl")

        # The job's model: a small folder with the adapter, the head and the report.
        with open(os.path.join(adapter_dir, "decision_report.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        saved = lab.save_model(adapter_dir, name="unsloth_decision_model")
        lab.log(f"✅ Model saved to job models directory: {saved}")
        if exports.get("gguf", {}).get("status") == "exported":
            lab.save_model(os.path.join(merged_dir, "gguf"), name="unsloth_decision_gguf")
        if save_merged and exports.get("merged", {}).get("status") == "saved":
            lab.save_model(merged_dir, name="unsloth_decision_merged")

        lab.log(f"Done in {report['wall_minutes']} min")
        lab.finish("Decision training completed")
        return {"status": "success", "job_id": lab.job.id, "before": _no_loss(base), "after": _no_loss(tuned)}

    except KeyboardInterrupt:
        lab.error("Stopped by user or remotely")
        return {"status": "stopped"}
    except Exception as e:
        msg = str(e)
        print(f"Decision training failed: {msg}", flush=True)
        traceback.print_exc()
        try:
            lab.error(msg)
        except Exception:
            pass
        return {"status": "error", "error": msg}


if __name__ == "__main__":
    print("🚀 Starting decision-model training...", flush=True)
    outcome = train_decision()
    print("Training result:", outcome, flush=True)
    if outcome.get("status") not in ("success", "stopped"):
        sys.exit(1)
