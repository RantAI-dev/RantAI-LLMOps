#!/usr/bin/env python3
"""
Training script using Unsloth FastLanguageModel with LoRA fine-tuning.

RantAI fork of transformerlab-app's `unsloth-llm-train`. Kept deliberately close
to upstream so it stays diffable; the deviations are all in service of running
correctly on a DGX Spark (GB10 / sm_121) and of never reporting a green run that
silently trained on the wrong thing:

  1. `load_in_4bit` is a config knob defaulting to FALSE (upstream hardcoded True).
     GB10 has 128 GB unified memory, so 4-bit buys nothing — and bitsandbytes'
     4-bit kernels are reported to stall on sm_121.
  2. Weights load in BF16 when not quantized (upstream passed dtype=None).
  3. The optimizer defaults to `adamw_torch` instead of `adamw_8bit`, keeping the
     hot path off bitsandbytes for the same reason.
  4. A dataset that fails to load raises instead of silently falling back to a
     3-row placeholder — upstream's fallback made a wrong dataset id look like a
     successful training run.
  5. Datasets may come from a local path, an http(s) URL or an S3/MinIO URI, not
     only the Hugging Face Hub — a corpus that must stay on-premise cannot be
     required to travel through huggingface.co to be trainable.
"""

from unsloth import FastLanguageModel
import os
from datetime import datetime

from lab import lab
from transformers import (
    TrainerCallback,
    TrainerControl,
    TrainerState,
    TrainingArguments,
)

# Login to huggingface
from huggingface_hub import login

if os.getenv("HF_TOKEN"):
    login(token=os.getenv("HF_TOKEN"))


class LabCallback(TrainerCallback):
    """Custom callback to update TransformerLab progress and save checkpoints"""

    def __init__(self):
        self.training_started = False
        self.total_steps = None

    def on_train_begin(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs,
    ):
        """Called when training begins"""
        lab.log("🚀 Training started with Unsloth FastLanguageModel")
        self.training_started = True
        if state.max_steps and state.max_steps > 0:
            self.total_steps = state.max_steps
        else:
            # Estimate steps if not provided
            self.total_steps = 1000

    def on_step_end(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs,
    ):
        """Called after each training step"""
        if self.total_steps:
            progress = int((state.global_step / self.total_steps) * 100)
            progress = min(progress, 95)  # Keep some buffer for final operations
            lab.update_progress(progress)

    def on_log(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        logs=None,
        **kwargs,
    ):
        """Called when the trainer logs metrics.

        Losses are reported from here rather than by reading `state.log_history`
        in on_step_end: by then global_step has already advanced, so every loss was
        labelled with the NEXT step's number and the final step's loss was never
        logged at all. `logs` here belongs to the step that just finished.
        """
        if logs and "loss" in logs:
            lab.log(f"Step {state.global_step}: loss={logs['loss']:.4f}")

    def on_save(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs,
    ):
        """Called when a checkpoint is saved"""
        lab.log(f"💾 Checkpoint saved at step {state.global_step}")

        # Attempt to save the checkpoint using lab's checkpoint mechanism
        if hasattr(args, "output_dir"):
            checkpoint_dir = None
            # Find the most recent checkpoint
            if os.path.exists(args.output_dir):
                checkpoints = [d for d in os.listdir(args.output_dir) if d.startswith("checkpoint-")]
                if checkpoints:
                    # Sort by checkpoint number
                    checkpoints.sort(key=lambda x: int(x.split("-")[1]))
                    latest_checkpoint = checkpoints[-1]
                    checkpoint_dir = os.path.join(args.output_dir, latest_checkpoint)

                    # Save checkpoint to TransformerLab
                    try:
                        saved_path = lab.save_checkpoint(checkpoint_dir, f"checkpoint-{state.global_step}")
                        lab.log(f"✅ Saved checkpoint to TransformerLab: {saved_path}")
                    except Exception as e:
                        lab.log(f"⚠️  Could not save checkpoint to TransformerLab: {e}")

    def on_epoch_end(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs,
    ):
        """Called at the end of each epoch"""
        if state.epoch:
            lab.log(f"📊 Completed epoch {int(state.epoch)} / {args.num_train_epochs}")

    def on_train_end(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs,
    ):
        """Called when training ends"""
        lab.log("✅ Training completed successfully")
        lab.update_progress(95)


def _load_training_dataset(spec: str):
    """Load the training dataset from `spec`, which may be any of:

      - a Hugging Face hub id       "owner/name" or "name"
      - a local file or directory   "/uidata/sft/train.jsonl", "/uidata/sft"
      - an http(s) URL              "https://minio.internal/sft/train.jsonl"
      - an S3 / MinIO URI           "s3://buku-korpus/sft/train.jsonl", or a prefix
                                    ending in "/" holding train.jsonl (+ eval.jsonl)

    Upstream only understood hub ids, which forced every dataset through
    huggingface.co — untenable for a corpus that is required to stay on-premise.
    S3 objects are pulled to local disk before training rather than streamed,
    matching how the training box is meant to be driven (limited NVMe, one pull
    per job) and keeping a failed download separate from a failed training step.

    A directory or S3 prefix picks up `eval.jsonl` as a `validation` split when
    present, so a 95/5 train/eval split needs no extra wiring.
    """
    from datasets import load_dataset

    def _from_files(train_file, eval_file=None):
        data_files = {"train": train_file}
        if eval_file:
            data_files["validation"] = eval_file
        return load_dataset("json", data_files=data_files)

    if spec.startswith("s3://"):
        try:
            import s3fs
        except ImportError as e:  # pragma: no cover - depends on the job venv
            raise RuntimeError(
                "An s3:// dataset needs the `s3fs` package — add it to the trainer setup."
            ) from e
        # MinIO (or any S3-compatible endpoint) is selected purely by env, so the
        # dataset reference stays portable across machines.
        endpoint = os.getenv("S3_ENDPOINT_URL") or os.getenv("AWS_ENDPOINT_URL")
        fs = s3fs.S3FileSystem(client_kwargs={"endpoint_url": endpoint} if endpoint else {})
        local_dir = os.path.abspath("_dataset")
        os.makedirs(local_dir, exist_ok=True)

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
        lab.log(f"Dataset source: S3/MinIO ({endpoint or 'default endpoint'})")
        return _from_files(train_local, eval_local)

    if spec.startswith("http://") or spec.startswith("https://"):
        lab.log("Dataset source: HTTP URL")
        return _from_files(spec)  # `datasets` resolves URLs itself

    if os.path.isdir(spec):

        def _pick(kind):
            """`<kind>.jsonl`, else the `*_<kind>.jsonl` a Transformer Lab upload
            leaves behind (it prefixes files with the dataset id)."""
            exact = os.path.join(spec, f"{kind}.jsonl")
            if os.path.exists(exact):
                return exact
            suffixed = sorted(
                f for f in os.listdir(spec) if f.endswith(f"_{kind}.jsonl")
            )
            return os.path.join(spec, suffixed[0]) if suffixed else None

        train_file = _pick("train")
        if not train_file:
            raise RuntimeError(f"Directory dataset '{spec}' has no train.jsonl or *_train.jsonl")
        lab.log(f"Dataset source: local directory {spec} (train={os.path.basename(train_file)})")
        return _from_files(train_file, _pick("eval"))

    if os.path.exists(spec):
        lab.log(f"Dataset source: local file {spec}")
        return _from_files(spec)

    lab.log("Dataset source: Hugging Face Hub")
    return load_dataset(spec)


def train_with_unsloth():
    """Training function using Unsloth FastLanguageModel with LoRA fine-tuning"""

    # Configure GPU usage - use only GPU 0
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"

    try:
        # Initialize lab
        lab.init()

        # Get parameters from task configuration
        config = lab.get_config()

        # Extract parameters with defaults
        model_name = config.get("model_name", "unsloth/Qwen2.5-0.5B-Instruct")
        dataset_name = config.get("dataset", "Trelis/touch-rugby-rules")
        lr = config.get("lr", 2e-4)
        num_train_epochs = config.get("num_train_epochs", 1)
        batch_size = config.get("batch_size", 2)
        gradient_accumulation_steps = config.get("gradient_accumulation_steps", 4)
        warmup_steps = config.get("warmup_steps", 5)
        max_steps = config.get("max_steps", -1)
        max_seq_length = config.get("max_seq_length", 2048)
        lora_r = config.get("lora_r", 16)
        lora_alpha = config.get("lora_alpha", 16)
        # 0 by default: Unsloth only takes its fast-patching path at dropout 0 and
        # warns "causing a performance hit" otherwise — a cost paid on every step of
        # every run. 0 is also the usual LoRA default. Raise it if evaluation shows
        # overfitting; the form exposes it.
        lora_dropout = config.get("lora_dropout", 0.0)
        logging_steps = config.get("logging_steps", 1)
        save_steps = config.get("save_steps", 50)
        weight_decay = config.get("weight_decay", 0.01)
        dataloader_num_workers = config.get("dataloader_num_workers", 0)
        # Quantization is opt-IN here. On GB10 (128 GB unified) 4-bit saves memory we
        # do not need while adding compute, and its kernels are reported to stall on
        # sm_121. Small-VRAM hosts can still turn it back on per job.
        load_in_4bit = bool(config.get("load_in_4bit", False))
        # adamw_8bit also routes through bitsandbytes; keep the default off it.
        optim = config.get("optim", "adamw_torch")

        # Training configuration
        training_config = {
            "experiment_name": "unsloth-lora-training",
            "model_name": model_name,
            "dataset": dataset_name,
            "template_name": "unsloth-demo",
            "output_dir": "./output",
            "log_to_wandb": False,
            "_config": {
                "dataset_name": dataset_name,
                "lr": lr,
                "num_train_epochs": num_train_epochs,
                "batch_size": batch_size,
                "gradient_accumulation_steps": gradient_accumulation_steps,
                "warmup_steps": warmup_steps,
                "max_steps": max_steps,
                "max_seq_length": max_seq_length,
                "lora_r": lora_r,
                "lora_alpha": lora_alpha,
                "lora_dropout": lora_dropout,
                "logging_steps": logging_steps,
                "save_steps": save_steps,
                "weight_decay": weight_decay,
                "dataloader_num_workers": dataloader_num_workers,
                "load_in_4bit": load_in_4bit,
                "optim": optim,
            },
        }

        lab.set_config(training_config)

        # Check if we should resume from a checkpoint
        checkpoint = lab.get_checkpoint_to_resume()
        if checkpoint:
            lab.log(f"📁 Resuming training from checkpoint: {checkpoint}")

        # Log start time
        start_time = datetime.now()
        lab.log(f"Training started at {start_time}")
        lab.log(f"Using GPU: {os.environ.get('CUDA_VISIBLE_DEVICES', 'All available')}")
        # Printed up front so a run's precision/limits are auditable from the log
        # alone — these are exactly the settings that used to fail silently.
        lab.log(
            f"⚙️  precision={'4-bit (QLoRA)' if load_in_4bit else 'BF16'} | optim={optim} | "
            f"max_seq_length={max_seq_length} | max_steps={max_steps} | epochs={num_train_epochs}"
        )

        # Create output directory if it doesn't exist
        os.makedirs(training_config["output_dir"], exist_ok=True)

        # Load dataset. NOTE: upstream caught failures here and continued with a
        # 3-row placeholder, so a bad dataset id finished "successfully" having
        # learned nothing from the real data. A wrong dataset must fail loudly.
        lab.log(f"Loading dataset: {training_config['dataset']}")
        try:
            dataset = _load_training_dataset(training_config["dataset"])
        except Exception as e:
            msg = f"Dataset '{training_config['dataset']}' could not be loaded: {e}"
            lab.log(f"❌ {msg}")
            lab.error(msg)
            raise RuntimeError(msg) from e

        if "train" not in dataset or len(dataset["train"]) == 0:
            msg = f"Dataset '{training_config['dataset']}' has no non-empty 'train' split."
            lab.log(f"❌ {msg}")
            lab.error(msg)
            raise RuntimeError(msg)

        lab.log(f"Loaded dataset with {len(dataset['train'])} examples")
        # Surfaced because the formatter below keys off column names: seeing them in
        # the log is how you catch a schema mismatch before wasting a training run.
        lab.log(f"Dataset columns: {dataset['train'].column_names}")

        lab.update_progress(20)

        # Load model and tokenizer using Unsloth. The name is logged BEFORE the
        # attempt because Unsloth's "No config file found" error never echoes back
        # which id it tried — leaving a wrong (or GGUF, which has no config.json)
        # model a dead end to diagnose from the log alone.
        lab.log(f"Loading model with Unsloth: {training_config['model_name']}")
        try:
            import torch

            model_name = training_config["model_name"]
            max_seq_length = training_config["_config"]["max_seq_length"]
            load_in_4bit = training_config["_config"]["load_in_4bit"]

            model, tokenizer = FastLanguageModel.from_pretrained(
                model_name=model_name,
                max_seq_length=max_seq_length,
                # Explicit BF16 when unquantized; let Unsloth decide under 4-bit.
                dtype=None if load_in_4bit else torch.bfloat16,
                load_in_4bit=load_in_4bit,
                use_gradient_checkpointing="unsloth",  # Efficient backpropagation
            )

            # Add pad token if it doesn't exist
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token

            lab.log(f"✅ Loaded model: {model_name}")

            # Add LoRA adapters for efficient fine-tuning
            lab.log("Adding LoRA adapters...")
            model = FastLanguageModel.get_peft_model(
                model,
                r=training_config["_config"]["lora_r"],  # Rank of LoRA matrices
                target_modules=[
                    "q_proj",
                    "k_proj",
                    "v_proj",
                    "o_proj",
                    "gate_proj",
                    "up_proj",
                    "down_proj",
                ],
                lora_alpha=training_config["_config"]["lora_alpha"],  # Scaling factor
                lora_dropout=training_config["_config"]["lora_dropout"],  # Dropout rate
                bias="none",  # Don't train bias
                use_gradient_checkpointing="unsloth",
                random_state=3407,
            )

            lab.log("✅ LoRA adapters added successfully")

        except ImportError as e:
            lab.log(f"⚠️  Unsloth not available: {e}")
            lab.log("Install with: pip install --upgrade --force-reinstall --no-cache-dir unsloth unsloth_zoo")
            lab.finish("Training skipped - unsloth not available")
            return {"status": "skipped", "reason": "unsloth not available"}
        except Exception as e:
            lab.log(f"Error loading model: {e}")
            import traceback

            traceback.print_exc()
            lab.finish("Training failed - model loading error")
            return {"status": "error", "error": str(e)}

        lab.update_progress(40)

        # Prepare dataset with chat template
        lab.log("Preparing dataset with chat template...")
        try:
            # (user turn, assistant turn) column pairs, in priority order. Upstream
            # only recognised instruction/output, so a prompt/completion dataset fell
            # through to the "join every field" branch below and trained on literal
            # "prompt: ...\ncompletion: ..." strings instead of the model's chat
            # format. These are the same pairs buildFormattingTemplate() documents.
            turn_pairs = (("instruction", "output"), ("prompt", "completion"), ("question", "answer"))
            cols = dataset["train"].column_names
            detected = next((p for p in turn_pairs if p[0] in cols and p[1] in cols), None)
            lab.log(
                f"Turn columns detected: {detected[0]} -> {detected[1]}"
                if detected
                else f"No known turn-column pair in {cols}; falling back to raw text"
            )

            # Apply chat template to format the dataset
            def format_dataset(example):
                # Handle different dataset formats - process one example at a time
                pair = next((p for p in turn_pairs if p[0] in example and p[1] in example), None)
                if pair:
                    user_turn = example[pair[0]]
                    assistant_turn = example[pair[1]]
                    # Use the model's chat template if available
                    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
                        messages = [
                            {"role": "user", "content": user_turn},
                            {"role": "assistant", "content": assistant_turn},
                        ]
                        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
                    else:
                        # Fallback format
                        text = f"### Instruction:\n{user_turn}\n\n### Response:\n{assistant_turn}"
                    return {"text": text}
                elif "text" in example:
                    # Already formatted - ensure it's a string
                    text = example["text"]
                    if isinstance(text, list):
                        text = "\n".join(str(t) for t in text)
                    return {"text": str(text)}
                else:
                    # Try to use first text-like field
                    for key in example.keys():
                        if "text" in key.lower() or "content" in key.lower():
                            text = example[key]
                            if isinstance(text, list):
                                text = "\n".join(str(t) for t in text)
                            return {"text": str(text)}
                    # Last resort: combine all fields
                    text_parts = [f"{k}: {v}" for k, v in example.items()]
                    return {"text": "\n".join(text_parts)}

            # Apply formatting - process one example at a time to avoid batching issues
            dataset["train"] = dataset["train"].map(
                format_dataset,
                batched=False,  # Process one at a time to avoid nested structures
                remove_columns=[col for col in dataset["train"].column_names if col != "text"],
            )

            lab.log("✅ Dataset formatted successfully")
            lab.log(f"Sample text length: {len(dataset['train'][0]['text']) if len(dataset['train']) > 0 else 0}")

            # Samples longer than max_seq_length are truncated by the trainer, which is
            # invisible in the logs — for RAG-style data (retrieved context inside the
            # prompt) that silently drops the very passage the answer is grounded in.
            try:
                over = sum(
                    1
                    for row in dataset["train"]
                    if len(tokenizer(row["text"], add_special_tokens=False)["input_ids"]) > max_seq_length
                )
                if over:
                    lab.log(
                        f"⚠️  {over}/{len(dataset['train'])} samples exceed max_seq_length="
                        f"{max_seq_length} and WILL BE TRUNCATED. Raise max_seq_length."
                    )
                else:
                    lab.log(f"✅ All samples fit within max_seq_length={max_seq_length}")
            except Exception as e:  # never let the audit itself break training
                lab.log(f"(could not audit sample lengths: {e})")

        except Exception as e:
            lab.log(f"⚠️  Error formatting dataset: {e}")
            import traceback

            traceback.print_exc()

        lab.update_progress(50)

        # Set up SFTTrainer
        lab.log("Setting up SFTTrainer...")
        try:
            from trl import SFTTrainer, SFTConfig

            # Training arguments optimized for Unsloth
            training_args = SFTConfig(
                output_dir=training_config["output_dir"],
                num_train_epochs=training_config["_config"]["num_train_epochs"],
                per_device_train_batch_size=training_config["_config"]["batch_size"],
                gradient_accumulation_steps=training_config["_config"]["gradient_accumulation_steps"],
                learning_rate=training_config["_config"]["lr"],
                warmup_steps=training_config["_config"]["warmup_steps"],
                max_steps=training_config["_config"]["max_steps"],
                weight_decay=training_config["_config"]["weight_decay"],
                logging_steps=training_config["_config"]["logging_steps"],
                save_steps=training_config["_config"]["save_steps"],
                fp16=not torch.cuda.is_bf16_supported(),
                bf16=torch.cuda.is_bf16_supported(),
                optim=training_config["_config"]["optim"],
                lr_scheduler_type="linear",
                seed=3407,
                logging_dir=f"{training_config['output_dir']}/logs",
                remove_unused_columns=False,
                push_to_hub=False,
                report_to="wandb" if training_config["log_to_wandb"] else "none",
                dataset_text_field="text",  # SFTTrainer will automatically tokenize this field
                max_seq_length=training_config["_config"]["max_seq_length"],
                packing=False,  # Don't pack sequences
                resume_from_checkpoint=checkpoint if checkpoint else None,
                save_total_limit=3,  # Keep only the last 3 checkpoints
                save_strategy="steps",
                load_best_model_at_end=False,
                dataloader_num_workers=training_config["_config"]["dataloader_num_workers"],
            )

            # Create custom callback for TransformerLab integration
            transformerlab_callback = LabCallback()

            # SFTTrainer handles tokenization automatically when using dataset_text_field
            # No need for a custom data collator
            trainer = SFTTrainer(
                model=model,
                args=training_args,
                train_dataset=dataset["train"],
                tokenizer=tokenizer,
                callbacks=[transformerlab_callback],
            )

            lab.log("✅ SFTTrainer created successfully")

        except Exception as e:
            lab.log(f"Error setting up SFTTrainer: {e}")
            import traceback

            traceback.print_exc()
            lab.finish("Training failed - trainer setup error")
            return {"status": "error", "error": str(e)}

        lab.update_progress(60)

        # Start training
        lab.log("🚀 Starting training...")

        try:
            # Train the model
            trainer.train()
            lab.log("✅ Training completed successfully")

            # Save the fine-tuned model
            lab.log("Saving fine-tuned model...")
            model.save_pretrained(training_config["output_dir"])
            tokenizer.save_pretrained(training_config["output_dir"])
            lab.log("✅ Model and tokenizer saved")

            # Create training summary artifact
            progress_file = os.path.join(training_config["output_dir"], "training_summary.json")
            import json

            with open(progress_file, "w") as f:
                json.dump(
                    {
                        "training_type": "Unsloth FastLanguageModel with LoRA",
                        "model_name": training_config["model_name"],
                        "dataset": training_config["dataset"],
                        "lora_r": training_config["_config"]["lora_r"],
                        "lora_alpha": training_config["_config"]["lora_alpha"],
                        "lora_dropout": training_config["_config"]["lora_dropout"],
                        "max_seq_length": training_config["_config"]["max_seq_length"],
                        "max_steps": training_config["_config"]["max_steps"],
                        "num_train_epochs": training_config["_config"]["num_train_epochs"],
                        "load_in_4bit": training_config["_config"]["load_in_4bit"],
                        "optim": training_config["_config"]["optim"],
                        "learning_rate": training_config["_config"]["lr"],
                        "batch_size": training_config["_config"]["batch_size"],
                        "gradient_accumulation_steps": training_config["_config"]["gradient_accumulation_steps"],
                        "completed_at": datetime.now().isoformat(),
                    },
                    f,
                    indent=2,
                )

            progress_artifact_path = lab.save_artifact(progress_file, "training_summary.json")
            lab.log(f"Saved training summary: {progress_artifact_path}")

        except Exception as e:
            lab.log(f"Error during training: {e}")
            import traceback

            traceback.print_exc()
            lab.finish("Training failed")
            return {"status": "error", "error": str(e)}

        lab.update_progress(90)

        # Calculate training time
        end_time = datetime.now()
        training_duration = end_time - start_time
        lab.log(f"Training completed in {training_duration}")

        # Save final artifacts
        final_model_file = os.path.join(training_config["output_dir"], "final_model_summary.txt")
        with open(final_model_file, "w") as f:
            f.write("Final Model Summary\n")
            f.write("==================\n")
            f.write(f"Training Duration: {training_duration}\n")
            f.write(f"Model: {training_config['model_name']}\n")
            f.write(f"Dataset: {training_config['dataset']}\n")
            f.write(f"LoRA Rank: {training_config['_config']['lora_r']}\n")
            f.write(f"LoRA Alpha: {training_config['_config']['lora_alpha']}\n")
            f.write(f"Completed at: {end_time}\n")

        final_model_path = lab.save_artifact(final_model_file, "final_model_summary.txt")
        lab.log(f"Saved final model summary: {final_model_path}")

        # Save training configuration as artifact
        config_file = os.path.join(training_config["output_dir"], "training_config.json")
        with open(config_file, "w") as f:
            json.dump(training_config, f, indent=2)

        config_artifact_path = lab.save_artifact(config_file, "training_config.json")
        lab.log(f"Saved training config: {config_artifact_path}")

        # Save the trained model
        model_dir = os.path.join(training_config["output_dir"], "final_model")
        os.makedirs(model_dir, exist_ok=True)

        # Copy model files to final_model directory
        import shutil

        for file in os.listdir(training_config["output_dir"]):
            if file.endswith((".bin", ".safetensors", ".json", ".txt")) and not file.startswith("checkpoint"):
                src = os.path.join(training_config["output_dir"], file)
                dst = os.path.join(model_dir, file)
                if os.path.isfile(src):
                    shutil.copy2(src, dst)

        saved_path = lab.save_model(model_dir, name="unsloth_trained_model")
        lab.log(f"✅ Model saved to job models directory: {saved_path}")

        # Finish wandb run if it was initialized
        try:
            import wandb

            if wandb.run is not None:
                wandb.finish()
                lab.log("✅ Wandb run finished")
        except Exception:
            pass

        print("Complete")

        # Complete the job in TransformerLab via facade
        lab.finish("Training completed successfully with Unsloth")

        return {
            "status": "success",
            "job_id": lab.job.id,
            "duration": str(training_duration),
            "output_dir": training_config["output_dir"],
            "saved_model_path": saved_path,
            "trainer_type": "Unsloth FastLanguageModel",
            "gpu_used": os.environ.get("CUDA_VISIBLE_DEVICES", "all"),
        }

    except KeyboardInterrupt:
        lab.error("Stopped by user or remotely")
        return {"status": "stopped", "job_id": lab.job.id}

    except Exception as e:
        error_msg = str(e)
        print(f"Training failed: {error_msg}")

        import traceback

        traceback.print_exc()
        lab.error(error_msg)
        return {"status": "error", "job_id": lab.job.id, "error": error_msg}


if __name__ == "__main__":
    print("🚀 Starting Unsloth training...")
    result = train_with_unsloth()
    print("Training result:", result)
