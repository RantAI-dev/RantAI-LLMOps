#!/usr/bin/env python3
"""
Vision-language LoRA fine-tuning with Unsloth (`FastVisionModel` + TRL `SFTTrainer`).

Sibling of `unsloth-llm-train` (same lab SDK wiring and the same fail-loud rules) and of
`unsloth-decision-train` (same pinned stack, proven on the GB10). It is a separate directory because the
text trainer pins an older stack and must stay stable, and because Transformer Lab sparse-clones ONE
directory per job, so it cannot import from its siblings: the helpers live next to this file
(vlm_schema.py, vlm_data.py, vlm_train_utils.py) and are unit-tested without a GPU.

What a run does (docs/RENCANA-VLM.md, Fase 4.3):

  1. read the parameters (lab.get_config) and validate them
  2. load the dataset: a JSONL of `messages` with images (local folder, UI upload, s3:// prefix pulled with
     its images/), or a Hugging Face dataset with an Image column. Rows are validated with vlm_schema; the
     images are decoded lazily, one row at a time
  3. load the model in BF16 on one GPU (`device_map={"": 0}`: never CPU-offloaded under a co-resident vLLM)
  4. cap the image size (Qwen-VL processors honour `max_pixels`; Gemma-3 resizes every image to 896x896 and
     has no such knob, so only the load-time downscale applies)
  5. LoRA on the language layers (default) and optionally the vision tower
  6. completion-only loss: the instruction/response markers come from the model's OWN chat template
  7. check the loss mask on the first batch BEFORE training: 0 % or 100 % trainable, image tokens in the
     loss, or an end-of-turn token outside the loss all stop the run with a clear message
  8. audit the token lengths WITH image tokens: a sample cut off behind its image has lost its label
  9. train, with loss lines printed as `{'loss': X}` so the UI curve (parse-loss.ts) picks them up
 10. save adapter + processor + tokenizer + training_config.json; any error -> lab.error and exit 1

Deviations, in the spirit of the SFT trainer:

  * no silent fallbacks: a dataset that fails validation, a missing image, a failed mask check all raise.
  * the process exits NON-ZERO on any failure, so the job is marked FAILED, never a green run without a model.
  * `optim` defaults to adamw_torch (no bitsandbytes on the hot path), 16-bit LoRA (4-bit is off).
  * the model is saved under the job model name `unsloth_vision_model` (NOT `unsloth_trained_model`), so
    nothing that lists text LoRA adapters picks it up by accident.

Recipe validated on the box (6 Nov 2026, Gemma-SEA-LION v4 4B VL, 24 LaTeX_OCR samples, 3 steps): 9 GiB GPU
peak, 6-7 s/step at batch 1 x accum 8, adapter with 476 LoRA keys and 0 vision keys.
"""

import os

# One GPU, unless the provider already chose. Must be set before torch initialises CUDA.
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")

from unsloth import FastVisionModel, UnslothVisionDataCollator  # noqa: E402,I001  (Unsloth first)

import json  # noqa: E402
import shutil  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import traceback  # noqa: E402
from datetime import datetime  # noqa: E402

import torch  # noqa: E402
from huggingface_hub import login  # noqa: E402
from lab import lab  # noqa: E402
from transformers import TrainerCallback  # noqa: E402

import vlm_data  # noqa: E402
import vlm_train_utils as vu  # noqa: E402

if os.getenv("HF_TOKEN"):
    login(token=os.getenv("HF_TOKEN"))


def log(msg: str) -> None:
    """lab.log for the job record AND stdout: only stdout reaches the job's stdout.log."""
    print(msg, flush=True)
    try:
        lab.log(msg)
    except Exception:  # noqa: BLE001 - logging must never break a run
        pass


def _fail(msg: str):
    log(f"❌ {msg}")
    try:
        lab.error(msg)
    except Exception:  # noqa: BLE001
        pass
    err = RuntimeError(msg)
    err._reported = True
    raise err


def _gpu_peak_gib() -> float:
    try:
        return round(torch.cuda.max_memory_allocated() / 1024**3, 2)
    except Exception:  # noqa: BLE001
        return 0.0


def _memory_line(tag: str) -> str:
    avail = vu.read_mem_available_gib()
    return f"memory[{tag}]: GPU peak {_gpu_peak_gib()} GiB, host MemAvailable {avail if avail is not None else '?'} GiB"


class LabCallback(TrainerCallback):
    """Progress to Transformer Lab and canonical loss lines to stdout."""

    FIRST_PCT, LAST_PCT = 60, 95

    def on_train_begin(self, args, state, control, **kwargs):
        log("🚀 Vision training started")

    def on_step_end(self, args, state, control, **kwargs):
        if state.max_steps and state.max_steps > 0:
            frac = min(1.0, state.global_step / state.max_steps)
            lab.update_progress(int(self.FIRST_PCT + (self.LAST_PCT - self.FIRST_PCT) * frac))
        if state.global_step == 1:
            log(_memory_line("after first step"))

    def on_log(self, args, state, control, logs=None, **kwargs):
        if not logs:
            return
        # print, not lab.log: only stdout reaches stdout.log, which the UI parses. transformers 5 prints
        # numbers as strings (`'loss': '1.234'`), which the loss chart does not parse: emit the canonical form.
        for key in ("loss", "eval_loss"):
            if key in logs:
                try:
                    value = float(logs[key])
                except (TypeError, ValueError):
                    continue
                if value == value and abs(value) != float("inf"):
                    print(f"{{'{key}': {value:.4f}, 'step': {state.global_step}}}", flush=True)
        if "loss" in logs:
            try:
                lab.log(f"Step {state.global_step}: loss={float(logs['loss']):.4f}")
            except Exception:  # noqa: BLE001
                pass

    def on_save(self, args, state, control, **kwargs):
        out = getattr(args, "output_dir", None)
        if not out or not os.path.isdir(out):
            return
        ckpts = [d for d in os.listdir(out) if d.startswith("checkpoint-") and d.split("-")[-1].isdigit()]
        if not ckpts:
            return
        latest = sorted(ckpts, key=lambda d: int(d.split("-")[-1]))[-1]
        try:
            lab.save_checkpoint(os.path.join(out, latest), f"checkpoint-{state.global_step}")
            log(f"💾 Checkpoint saved at step {state.global_step}")
        except Exception as e:  # noqa: BLE001
            log(f"⚠️  Could not save checkpoint to Transformer Lab: {e}")

    def on_epoch_end(self, args, state, control, **kwargs):
        if state.epoch:
            log(f"📊 Completed epoch {int(state.epoch)} / {args.num_train_epochs}")

    def on_train_end(self, args, state, control, **kwargs):
        log("✅ Training finished")
        lab.update_progress(95)


class MaskedImageCollator:
    """Wraps UnslothVisionDataCollator and forces image placeholder tokens out of the loss.

    The collator's own masking of image tokens is not something to rely on silently: if it ever leaves
    them trainable the model is taught to emit image placeholders. This makes the guarantee explicit and
    counts how many labels it had to fix (logged on the first batch; non-zero means the collator did not)."""

    def __init__(self, inner, image_ids):
        self.inner = inner
        self.image_ids = list(image_ids)
        self.fixed = 0

    def __call__(self, features):
        batch = self.inner(features)
        if self.image_ids and "labels" in batch:
            ids = torch.tensor(self.image_ids, device=batch["input_ids"].device)
            is_image = torch.isin(batch["input_ids"], ids)
            self.fixed += int(((batch["labels"] != vu.IGNORE_INDEX) & is_image).sum())
            batch["labels"] = batch["labels"].masked_fill(is_image, vu.IGNORE_INDEX)
        return batch


def _user_images(messages):
    return [p["image"] for m in messages for p in m["content"] if p.get("type") == "image"]


def _token_length(processor, render, messages) -> int:
    """Tokens of one sample INCLUDING the tokens its images expand into (the processor does the expansion)."""
    text = render(messages)
    images = _user_images(messages)
    kwargs = {"text": [text], "return_tensors": "pt"}
    if images:
        kwargs["images"] = [images]
    enc = processor(**kwargs)
    return int(enc["input_ids"].shape[-1])


def train_vision():
    try:
        lab.init()
        config = lab.get_config()
        try:
            p = vu.read_params(config)
        except vu.ParamError as e:
            _fail(f"Invalid parameters: {e}")

        output_dir = "./output"
        final_dir = os.path.join(output_dir, "final_model")
        os.makedirs(final_dir, exist_ok=True)
        lab.set_config(
            {
                "experiment_name": "unsloth-vision-training",
                "model_name": p.model_name,
                "dataset": p.dataset,
                "template_name": "unsloth-vision",
                "output_dir": output_dir,
                "log_to_wandb": False,
                "_config": p.to_dict(),
            }
        )
        checkpoint = lab.get_checkpoint_to_resume()
        if checkpoint:
            log(f"📁 Resuming training from checkpoint: {checkpoint}")
        start = datetime.now()
        log(f"Training started at {start}")
        log(
            f"⚙️  precision=BF16 | optim={p.optim} | max_seq_length={p.max_seq_length} | max_steps={p.max_steps} | "
            f"epochs={p.num_train_epochs} | batch={p.batch_size}x{p.gradient_accumulation_steps} | "
            f"vision_layers={p.finetune_vision_layers} language_layers={p.finetune_language_layers} | "
            f"max_pixels={p.max_pixels} max_images={p.max_images_per_sample}"
        )
        log(_memory_line("start"))

        # ── 2. data ────────────────────────────────────────────────────────────────
        log(f"Loading dataset: {p.dataset}")
        try:
            data = vlm_data.build_datasets(
                p.dataset,
                max_pixels=p.max_pixels,
                max_images=p.max_images_per_sample,
                max_train_rows=p.max_train_rows,
                max_eval_rows=p.max_eval_rows,
                hf=vlm_data.HfOptions(
                    image_column=p.image_column,
                    prompt_column=p.prompt_column,
                    answer_column=p.answer_column,
                    prompt_text=p.prompt_text,
                    system_prompt=p.system_prompt,
                    split=p.hf_split,
                    config=p.hf_config,
                    max_images=p.max_images_per_sample,
                ),
                workdir=os.path.abspath("_dataset"),
                log=log,
            )
        except vlm_data.DatasetError as e:
            _fail(f"Dataset '{p.dataset}' cannot be used: {e}")
        log(f"✅ Dataset: {data.n_train} train rows, {data.n_eval} eval rows ({data.eval_source}); source: {data.source}")
        if "train_rows_available" in data.info or "eval_rows_available" in data.info:
            log(f"Row caps: train {data.n_train} of {data.info.get('train_rows_available', data.n_train)}, "
                f"eval {data.n_eval} of {data.info.get('eval_rows_available', data.n_eval)} (max_train_rows={p.max_train_rows}, max_eval_rows={p.max_eval_rows})")
        if data.info:
            log(f"Dataset info: {json.dumps(data.info, default=str)}")
        lab.update_progress(20)

        # ── 3-5. model, processor, LoRA ────────────────────────────────────────────
        log(f"Loading model with Unsloth: {p.model_name}")
        model, processor = FastVisionModel.from_pretrained(
            p.model_name,
            load_in_4bit=False,
            dtype=torch.bfloat16,
            # Pin to GPU 0. With device_map='auto' accelerate offloads layers to CPU when a co-resident vLLM
            # holds VRAM, and a multi-device model cannot be trained.
            device_map={"": 0},
            use_gradient_checkpointing="unsloth",
        )
        tokenizer = getattr(processor, "tokenizer", processor)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        log(f"✅ Loaded model: {p.model_name} ({type(model).__name__}); {_memory_line('after load')}")
        log(f"Image setting: {vu.apply_max_pixels(processor, p.max_pixels)}")
        log(vu.skip_trackio_model_card())

        model = FastVisionModel.get_peft_model(
            model,
            finetune_vision_layers=p.finetune_vision_layers,
            finetune_language_layers=p.finetune_language_layers,
            finetune_attention_modules=True,
            finetune_mlp_modules=True,
            r=p.lora_r,
            lora_alpha=p.lora_alpha,
            lora_dropout=p.lora_dropout,
            bias="none",
            random_state=3407,
        )
        FastVisionModel.for_training(model)
        log("✅ LoRA adapters added")
        lab.update_progress(40)

        # ── 6. markers from the model's own chat template ─────────────────────────
        def render(messages):
            return processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)

        first = data.train[0]["messages"]
        try:
            markers = vu.derive_turn_markers(render, sample_text=render(first))
        except vu.MarkerError as e:
            _fail(f"Cannot derive the turn markers from the chat template: {e}")
        log(
            f"Turn markers: instruction={markers.instruction_part!r} response={markers.response_part!r} "
            f"terminator={markers.terminator!r}" + (f" ({'; '.join(markers.notes)})" if markers.notes else "")
        )

        # ── 8. length audit with image tokens ─────────────────────────────────────
        idx = vu.sample_indices(len(data.train))
        lengths, errors = [], []
        for i in idx:
            try:
                lengths.append(_token_length(processor, render, data.train[i]["messages"]))
            except Exception as e:  # noqa: BLE001
                errors.append(f"row {i}: {type(e).__name__}: {e}")
        if errors:
            log(f"⚠️  {len(errors)}/{len(idx)} audited samples could not be tokenised; first: {errors[0]}")
        if not lengths:
            _fail(f"No sample could be tokenised with this processor. {errors[0] if errors else ''}")
        audit = vu.audit_lengths(lengths, p.max_seq_length)
        log(f"{'❌' if audit.failed else '✅'} Length audit: {audit.message}")
        if audit.failed:
            _fail(audit.message)
        if p.max_seq_length < 1024:
            log("⚠️  max_seq_length < 1024: a sequence cut inside the image tokens makes the processor fail; keep it above the image token count")

        # ── 7. collator + first-batch mask check ──────────────────────────────────
        image_ids = vu.image_token_ids(getattr(model, "config", None), processor, tokenizer)
        log(f"Image token ids: {image_ids}")
        inner = UnslothVisionDataCollator(
            model,
            processor,
            max_seq_length=p.max_seq_length,
            train_on_responses_only=True,
            instruction_part=markers.instruction_part,
            response_part=markers.response_part,
        )
        collator = MaskedImageCollator(inner, image_ids)

        eot_ids = []
        if markers.terminator.strip():
            enc = tokenizer.encode(markers.terminator.strip(), add_special_tokens=False)
            if len(enc) == 1:
                eot_ids = enc
            else:
                log(f"(end-of-turn token {markers.terminator.strip()!r} is {len(enc)} tokens: end-of-turn check skipped)")
        probe = [data.train[i] for i in range(min(2, len(data.train)))]
        batch = collator(probe)
        report = vu.check_mask(
            batch["input_ids"],
            batch["labels"],
            image_token_ids=image_ids,
            eot_token_ids=eot_ids,
            expected_eot_per_row=[vu.count_assistant_turns(s["messages"]) for s in probe],
            attention_mask=batch.get("attention_mask"),
            max_length=p.max_seq_length,
            expect_images=any(_user_images(s["messages"]) for s in probe),
        )
        log(f"  {report.summary()}")
        if collator.fixed:
            log(f"  note: the collator left {collator.fixed} image token label(s) trainable; the wrapper masked them")
        keep = [int(t) for t, l in zip(batch["input_ids"][0].tolist(), batch["labels"][0].tolist()) if l != vu.IGNORE_INDEX]
        log(f"  first sample, trainable text: {tokenizer.decode(keep)[:200]!r}")
        if not report.ok:
            _fail("Loss mask check failed before training: " + "; ".join(report.problems))
        log("✅ Completion-only loss ON: prompt and image masked, loss on the answer and its end-of-turn token")
        collator.fixed = 0
        lab.update_progress(50)

        # ── 8b. SFTConfig + trainer ───────────────────────────────────────────────
        from trl import SFTConfig, SFTTrainer

        has_eval = data.eval is not None and len(data.eval) > 0
        args = SFTConfig(
            output_dir=output_dir,
            num_train_epochs=p.num_train_epochs,
            per_device_train_batch_size=p.batch_size,
            gradient_accumulation_steps=p.gradient_accumulation_steps,
            learning_rate=p.lr,
            warmup_steps=p.warmup_steps,
            max_steps=p.max_steps,
            weight_decay=p.weight_decay,
            logging_steps=p.logging_steps,
            save_steps=p.save_steps,
            save_strategy="steps",
            save_total_limit=3,
            bf16=True,
            optim=p.optim,
            lr_scheduler_type="linear",
            seed=3407,
            report_to="none",
            push_to_hub=False,
            # the data collator builds the batches; TRL must not touch the dataset
            remove_unused_columns=False,
            dataset_text_field="",
            dataset_kwargs={"skip_prepare_dataset": True},
            max_length=p.max_seq_length,
            dataloader_num_workers=p.dataloader_num_workers,
            eval_strategy="steps" if has_eval else "no",
            eval_steps=p.eval_steps,
            per_device_eval_batch_size=p.batch_size,
            load_best_model_at_end=False,
        )
        trainer = SFTTrainer(
            model=model,
            train_dataset=vlm_data.as_hf_dataset(data.train),
            eval_dataset=vlm_data.as_hf_dataset(data.eval) if has_eval else None,
            processing_class=processor,
            data_collator=collator,
            args=args,
            callbacks=[LabCallback()],
        )
        log("✅ SFTTrainer created")
        lab.update_progress(60)

        # ── 9. train ──────────────────────────────────────────────────────────────
        log("🚀 Starting training...")
        t0 = time.time()
        trainer.train(resume_from_checkpoint=checkpoint or None)
        minutes = round((time.time() - t0) / 60, 1)
        log(f"✅ Training completed in {minutes} min; {_memory_line('end')}")
        if collator.fixed:
            log(f"  note: {collator.fixed} image token label(s) were masked by the wrapper during training")

        # ── 10. save ──────────────────────────────────────────────────────────────
        log("Saving adapter, processor and tokenizer...")
        model.save_pretrained(final_dir)
        processor.save_pretrained(final_dir)
        if tokenizer is not processor:
            tokenizer.save_pretrained(final_dir)
        adapter = _check_saved(final_dir, p)
        cfg = {
            "vision": True,
            "base_model": p.model_name,
            "dataset": p.dataset,
            "finetune_vision_layers": p.finetune_vision_layers,
            "finetune_language_layers": p.finetune_language_layers,
            "max_pixels": p.max_pixels,
            "max_images_per_sample": p.max_images_per_sample,
            "max_seq_length": p.max_seq_length,
            "lora_r": p.lora_r,
            "lora_alpha": p.lora_alpha,
            "instruction_part": markers.instruction_part,
            "response_part": markers.response_part,
            "adapter_keys": adapter,
            "train_rows": data.n_train,
            "eval_rows": data.n_eval,
            "train_minutes": minutes,
            "gpu_peak_gib": _gpu_peak_gib(),
            "completed_at": datetime.now().isoformat(),
        }
        cfg_path = os.path.join(final_dir, "training_config.json")
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        try:
            lab.save_artifact(cfg_path, "training_config.json")
        except Exception as e:  # noqa: BLE001
            log(f"(could not save the training_config artifact: {e})")
        saved = lab.save_model(final_dir, name="unsloth_vision_model")
        log(f"✅ Model saved to job models directory: {saved}")

        shutil.rmtree(os.path.join(os.path.abspath("_dataset")), ignore_errors=True)
        print("Complete", flush=True)
        lab.finish("Vision training completed")
        return {"status": "success", "job_id": lab.job.id, "duration": str(datetime.now() - start), "saved_model_path": saved}

    except KeyboardInterrupt:
        lab.error("Stopped by user or remotely")
        return {"status": "stopped"}
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        print(f"Vision training failed: {msg}", flush=True)
        traceback.print_exc()
        if not getattr(e, "_reported", False):  # _fail already told the lab
            try:
                lab.error(msg)
            except Exception:  # noqa: BLE001
                pass
        return {"status": "error", "error": msg}


def _check_saved(final_dir: str, p: "vu.VisionParams") -> dict:
    """The adapter must really be on disk, with a processor next to it, and touch the layers the run asked for."""
    cfg_file = os.path.join(final_dir, "adapter_config.json")
    weights = os.path.join(final_dir, "adapter_model.safetensors")
    if not (os.path.isfile(cfg_file) and os.path.isfile(weights)):
        _fail(f"Saving failed: no adapter_config.json / adapter_model.safetensors in {final_dir} (found: {sorted(os.listdir(final_dir))})")
    if not any(os.path.isfile(os.path.join(final_dir, f)) for f in ("preprocessor_config.json", "processor_config.json")):
        _fail(f"Saving failed: the processor config is missing in {final_dir}; the adapter could not be served with images")
    from safetensors import safe_open

    with safe_open(weights, framework="pt") as f:
        report = vu.adapter_key_report(list(f.keys()))
    log(f"Adapter: {report['lora']} LoRA keys, {report['vision']} in the vision tower/projector (of {report['total']} tensors)")
    if report["lora"] == 0:
        _fail("The saved adapter has no LoRA weights")
    if p.finetune_vision_layers is False and report["vision"] > 0:
        _fail(f"finetune_vision_layers is off but the adapter has {report['vision']} vision LoRA keys")
    if p.finetune_vision_layers and report["vision"] == 0:
        _fail("finetune_vision_layers is on but the adapter has no vision LoRA keys")
    return report


if __name__ == "__main__":
    print("🚀 Starting vision-model training...", flush=True)
    outcome = train_vision()
    print("Training result:", outcome, flush=True)
    # A caught failure must exit non-zero, or Transformer Lab marks the job COMPLETE with no model.
    if outcome.get("status") not in ("success", "stopped"):
        sys.exit(1)
