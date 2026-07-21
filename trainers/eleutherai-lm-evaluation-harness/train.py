#!/usr/bin/env python3
"""
EleutherAI LM Evaluation Harness script with TransformerLab integration.

RantAI fork of transformerlab-app's `eleutherai-lm-evaluation-harness`. Kept
deliberately close to upstream so it stays diffable; the deviations are:

  1. `--model_args` names a `dtype` (config knob, default bfloat16). Upstream
     passed none, so weights loaded as fp16 while Apertus' xIELU activation
     builds its parameters in bf16. Mixing the two promotes to fp32, and the
     next Linear then rejects its own input — "expected mat1 and mat2 to have
     the same dtype, but got: float != c10::Half" — which killed every Apertus
     benchmark before the first sample was scored.

  2. The per-sample artifact stores the READABLE option text the model picked
     and the correct one, not the raw log-likelihood and gold index. Upstream
     wrote "-20.5" as the answer and "3" as the expected value, which is
     meaningless to anyone reading the breakdown. Option text comes from the
     processed doc's choice list where present (arc stores {"text","label"}),
     falling back to each sample's `arguments` (a dict keyed "gen_args_N", each
     value {"arg_0": context, "arg_1": option}). The enrichment is best-effort
     and wrapped: any unexpected shape falls back to the raw values for that one
     sample rather than aborting the whole samples file.

This script demonstrates:
- Using lab.get_config() to read parameters from task configuration
- Running evaluations on language models using the EleutherAI LM Evaluation Harness
- Saving detailed evaluation results as artifacts
"""

import os
import json
import subprocess
import re
from datetime import datetime

from lab import lab

# Login to huggingface
from huggingface_hub import login

if os.getenv("HF_TOKEN"):
    login(token=os.getenv("HF_TOKEN"))


def get_detailed_file_names(output_file_path, prefix="samples_", suffix=".jsonl"):
    """This function fetches all the .jsonl files that EleutherAI LM Evaluation Harness
    generates so we can process the results for each test case"""
    try:
        matching_files = []
        for root, _dirs, files in os.walk(output_file_path):
            for file in files:
                if file.startswith(prefix) and file.endswith(suffix):
                    matching_files.append(os.path.join(root, file))
        return matching_files
    except Exception as e:
        lab.log(f"An error occurred while getting the output file name: {e}")
        return []


def run_evaluation():
    """Run the EleutherAI LM Evaluation Harness"""

    # Configure GPU usage - use only GPU 0
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"

    try:
        # Initialize lab (auto-loads parameters from job_data if available)
        lab.init()

        # Get parameters from task configuration
        config = lab.get_config()

        # Extract parameters with defaults
        model_name = config.get("model_name", "HuggingFaceTB/SmolLM-135M-Instruct")
        model_path = config.get("model_path", "")
        model_adapter = config.get("model_adapter", "")
        tasks = config.get("tasks", "mmlu_abstract_algebra")
        limit = config.get("limit", "1.0")
        # Weight dtype for the harness. Upstream passed none, so the weights loaded
        # as fp16 while Apertus' xIELU activation builds its parameters in bf16 —
        # bf16 * fp16 promotes to fp32, and the next Linear then rejects its own
        # input: "expected mat1 and mat2 to have the same dtype, float != c10::Half".
        # Naming one dtype for everything removes the mismatch, and bf16 is what
        # this hardware and that activation both default to. Configurable so a host
        # without bf16 support can still ask for float16.
        dtype = str(config.get("dtype", "bfloat16")).strip()

        # Validate parameters
        if not model_name or model_name == "":
            lab.error("No model provided. Please re-run after setting a model name.")
            return {"status": "error", "error": "No model provided"}

        # If tasks is a JSON string of list of tasks, convert to comma-separated string
        if isinstance(tasks, str):
            try:
                tasks_list = json.loads(tasks)
                if isinstance(tasks_list, list):
                    tasks = ",".join(tasks_list)
            except json.JSONDecodeError:
                # assuming tasks is already a comma-separated string
                pass

        # Validate limit
        if limit:
            try:
                limit_val = float(limit)
                if limit_val < 0:
                    lab.error("Limit must be a positive number.")
                    return {"status": "error", "error": "Invalid limit value"}
                if limit_val > 1:
                    lab.error("Limit should be between 0 and 1.")
                    return {"status": "error", "error": "Invalid limit value"}
                if limit_val == 1:
                    limit = None
            except ValueError:
                lab.error("Limit must be a number.")
                return {"status": "error", "error": "Invalid limit value"}

        # Use model_path as model_name if provided
        if model_path and model_path.strip() != "":
            model_name = model_path
            lab.log(f"Model path provided. Using model path as model name: {model_name}")

        # Log start time
        start_time = datetime.now()
        lab.log(f"Evaluation started at {start_time}")
        lab.log(f"Model: {model_name}")
        lab.log(f"Tasks: {tasks}")
        lab.log(f"Limit: {limit if limit else 'No limit (all samples)'}")
        lab.log(f"Using GPU: {os.environ.get('CUDA_VISIBLE_DEVICES', 'All available')}")
        # Printed up front so a dtype problem is visible before the traceback is.
        lab.log(f"⚙️  dtype={dtype or 'default (tidak diset)'}")

        # Prepare output directory
        output_dir = "./eval_output"
        os.makedirs(output_dir, exist_ok=True)

        lab.update_progress(10)

        # Determine which model backend to use based on CUDA availability
        try:
            import torch

            use_cuda = torch.cuda.is_available()
        except ImportError:
            use_cuda = False
            lab.log("⚠️  PyTorch not available, attempting CPU-based evaluation")

        if not use_cuda:
            lab.log("CUDA is not available. Running CPU-based evaluation.")

            # Build model args for CPU-based evaluation
            model_args = f"model={model_name},trust_remote_code=True"
            if dtype:
                model_args += f",dtype={dtype}"

            if model_adapter and model_adapter.strip() != "":
                adapter_path = os.path.abspath(model_adapter)
                model_args += f",peft={adapter_path}"
                lab.log(f"Using adapter: {adapter_path}")

            command = [
                "python",
                "-m",
                "lm_eval",
                "--model",
                "hf",
                "--model_args",
                model_args,
                "--tasks",
                tasks,
                "--log_samples",
            ]
        else:
            # Build model args for CUDA-based evaluation
            model_args = f"pretrained={model_name},trust_remote_code=True"
            if dtype:
                model_args += f",dtype={dtype}"

            if model_adapter and model_adapter.strip() != "":
                adapter_path = os.path.abspath(model_adapter)
                model_args += f",peft={adapter_path}"
                lab.log(f"Using adapter: {adapter_path}")

            command = [
                "python",
                "-m",
                "lm_eval",
                "--model",
                "hf",
                "--model_args",
                model_args,
                "--tasks",
                tasks,
                "--device",
                "cuda:0",
                "--trust_remote_code",
                "--log_samples",
            ]

        # Add limit if provided
        if limit and float(limit) != 1.0:
            command.extend(["--limit", str(limit)])

        # Add output path
        command.extend(["--output_path", output_dir])

        lab.log("Running command: $ " + " ".join(command))
        lab.log("--Beginning to run evaluations (please wait)...")

        lab.update_progress(20)

        # Run subprocess
        with subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            universal_newlines=True,
        ) as process:
            for line in process.stdout:
                line_stripped = line.strip()
                lab.log(line_stripped)

                # Parse progress from output
                pattern = r"^Running.*?(\d+)%\|"
                match = re.search(pattern, line_stripped)
                if match:
                    progress = int(match.group(1))
                    # Map to 20-80% range for evaluation progress
                    lab.update_progress(20 + int(progress * 0.6))

            process.wait()
            if process.returncode != 0:
                lab.log(f"⚠️  Evaluation returned non-zero exit code: {process.returncode}")
                lab.error(f"Evaluation failed with exit code: {process.returncode}")
                return {"status": "error", "error": f"Exit code {process.returncode}"}

        lab.update_progress(80)

        # Get detailed report files
        detailed_report_files = get_detailed_file_names(output_dir)
        lab.log(f"Found {len(detailed_report_files)} detailed report files")

        # Parse evaluation results
        results_file = None
        samples_files = {}

        # Search for both results.json and samples.jsonl files
        if os.path.exists(output_dir):
            for root, dirs, files in os.walk(output_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    if file.startswith("results_") and file.endswith(".json") and results_file is None:
                        results_file = file_path
                    elif file.startswith("samples_") and file.endswith(".jsonl"):
                        # Extract task name from filename
                        task_name = file.replace("samples_", "").replace(".jsonl", "")
                        samples_files[task_name] = file_path

        # Parse aggregated results from JSON file
        if results_file and os.path.exists(results_file):
            lab.log(f"Found results file: {results_file}")
            try:
                with open(results_file, "r") as f:
                    eval_results_data = json.load(f)

                # Save the full results as an artifact
                results_artifact_path = lab.save_artifact(results_file, name="evaluation_results.json", type="evals")
                lab.log(f"✅ Saved full results: {results_artifact_path}")

                # Extract aggregated metrics for each task
                if "results" in eval_results_data:
                    for task_name, task_results in eval_results_data["results"].items():
                        lab.log(f"Processing task: {task_name}")

                        # Extract metrics data for DataFrame
                        metrics_data = []
                        for key, value in task_results.items():
                            if isinstance(value, (int, float)):
                                metrics_data.append(
                                    {
                                        "test_case_id": "aggregated",
                                        "metric_name": key,
                                        "score": value,
                                        "input": task_name,
                                        "output": "",
                                        "expected_output": "",
                                    }
                                )

                        if metrics_data:
                            import pandas as pd

                            df_metrics = pd.DataFrame(metrics_data)

                            # Extract main accuracy metric for logging
                            acc_key = None
                            for key in task_results.keys():
                                if key.startswith("acc") and not key.endswith("stderr"):
                                    acc_key = key
                                    break

                            if acc_key:
                                acc_value = task_results.get(acc_key, 0.0)
                                lab.log(f"✅ {task_name}: {acc_key} = {acc_value}")

                            # Save aggregated metrics as eval artifact
                            saved_metrics_path = lab.save_artifact(
                                df_metrics,
                                name=f"eval_metrics_{task_name}.csv",
                                type="evals",
                                config={
                                    "evals": {
                                        "input": "input",
                                        "output": "output",
                                        "expected_output": "expected_output",
                                        "score": "score",
                                    }
                                },
                            )
                            lab.log(f"✅ Saved metrics for {task_name}: {saved_metrics_path}")

                else:
                    lab.log("⚠️  No 'results' key found in results file")

            except Exception as e:
                lab.log(f"⚠️  Error parsing results file: {e}")
                import traceback

                traceback.print_exc()

        # Parse detailed samples from JSONL files
        for task_name, samples_file in samples_files.items():
            if os.path.exists(samples_file):
                lab.log(f"Processing samples file for task: {task_name}")
                try:
                    import pandas as pd

                    # Read JSONL file line by line
                    samples_data = []
                    with open(samples_file, "r") as f:
                        for line in f:
                            if line.strip():
                                sample = json.loads(line.strip())

                                # Extract relevant fields for eval DataFrame
                                doc = sample.get("doc", {})
                                filtered_resps = sample.get("filtered_resps", [])
                                target = sample.get("target", "")

                                # BASELINE (never fails): the raw values upstream stored —
                                # a log-likelihood as the "answer" and the gold INDEX as
                                # "expected". Meaningless to a human, but always available,
                                # so the readable version below can enrich ON TOP and fall
                                # back here if anything about the sample's shape surprises
                                # us. An earlier attempt read `arguments` assuming it was a
                                # list; lm-eval logs it as a dict, the KeyError escaped, and
                                # it took the WHOLE samples file down with it. Never again:
                                # the enrichment is wrapped so one odd sample cannot.
                                output = ""
                                if filtered_resps:
                                    for resp in filtered_resps:
                                        if isinstance(resp, (list, tuple)) and len(resp) >= 2 and resp[1] is True:
                                            output = str(resp[0])
                                            break
                                    if not output:
                                        first = filtered_resps[0]
                                        output = str(first[0]) if isinstance(first, (list, tuple)) and first else ""
                                expected = str(target)
                                question = ""
                                if isinstance(doc, dict):
                                    for key in ("question", "goal", "sentence", "ctx", "query", "premise"):
                                        val = doc.get(key)
                                        if isinstance(val, str) and val.strip():
                                            question = val.strip()
                                            break
                                if not question:
                                    question = str(doc)

                                # READABLE enrichment (best-effort). Multiple-choice tasks
                                # score each option by log-likelihood; the model's pick is
                                # the option with the highest one. We turn the pick and the
                                # gold index into their option TEXT. `arguments` is normalised
                                # first because lm-eval logs it as a dict keyed "gen_args_N",
                                # each value {"arg_0": context, "arg_1": option}, though older
                                # builds used a list of (context, option) tuples.
                                try:
                                    if isinstance(arguments := sample.get("arguments"), dict):
                                        arg_items = list(arguments.values())
                                    elif isinstance(arguments, (list, tuple)):
                                        arg_items = list(arguments)
                                    else:
                                        arg_items = []

                                    def _continuation(item):
                                        if isinstance(item, dict):
                                            return str(item.get("arg_1", item.get("continuation", ""))).strip()
                                        if isinstance(item, (list, tuple)) and len(item) > 1:
                                            return str(item[1]).strip()
                                        return ""

                                    # Prefer the option list off the processed doc — the most
                                    # reliable source across tasks. arc stores it as
                                    # {"text": [...], "label": [...]}; others as a plain list.
                                    choices = []
                                    doc_choices = doc.get("choices") if isinstance(doc, dict) else None
                                    if isinstance(doc_choices, dict) and isinstance(doc_choices.get("text"), list):
                                        choices = [str(c).strip() for c in doc_choices["text"]]
                                    elif isinstance(doc_choices, list) and all(isinstance(c, str) for c in doc_choices):
                                        choices = [c.strip() for c in doc_choices]
                                    if not choices:
                                        choices = [_continuation(it) for it in arg_items]

                                    def _choice_text(idx):
                                        try:
                                            i = int(idx)
                                        except (ValueError, TypeError):
                                            return ""
                                        return choices[i] if 0 <= i < len(choices) else ""

                                    logprobs = [
                                        float(r[0])
                                        for r in filtered_resps
                                        if isinstance(r, (list, tuple)) and len(r) > 0
                                    ]
                                    pred_idx = logprobs.index(max(logprobs)) if logprobs else None

                                    pred_text = _choice_text(pred_idx)
                                    exp_text = _choice_text(target)
                                    if pred_text:
                                        output = pred_text
                                    if exp_text:
                                        expected = exp_text
                                    # The shared context also carries the question for tasks
                                    # whose doc lacks a plain field.
                                    if question == str(doc) and arg_items:
                                        ctx = arg_items[0]
                                        ctx_text = ctx.get("arg_0", "") if isinstance(ctx, dict) else (
                                            ctx[0] if isinstance(ctx, (list, tuple)) and ctx else ""
                                        )
                                        if str(ctx_text).strip():
                                            question = str(ctx_text).strip()
                                except Exception as enrich_err:  # noqa: BLE001 — never lose the file
                                    lab.log(f"⚠️  Sampel {sample.get('doc_id', '?')}: pakai nilai mentah ({enrich_err})")

                                samples_data.append(
                                    {
                                        "test_case_id": f"test_case_{sample.get('doc_id', 0)}",
                                        "metric_name": task_name,
                                        "score": sample.get("acc", 0.0),
                                        "input": question,
                                        "output": output,
                                        "expected_output": expected,
                                    }
                                )

                    if samples_data:
                        df_samples = pd.DataFrame(samples_data)
                        lab.log(f"Parsed {len(df_samples)} detailed samples for {task_name}")

                        # Save detailed samples as eval artifact
                        saved_samples_path = lab.save_artifact(
                            df_samples,
                            name=f"eval_samples_{task_name}.csv",
                            type="evals",
                            config={
                                "evals": {
                                    "input": "input",
                                    "output": "output",
                                    "expected_output": "expected_output",
                                    "score": "score",
                                }
                            },
                        )
                        lab.log(f"✅ Saved detailed samples for {task_name}: {saved_samples_path}")

                except Exception as e:
                    lab.log(f"⚠️  Error parsing samples file for {task_name}: {e}")
                    import traceback

                    traceback.print_exc()

        lab.update_progress(90)

        # Calculate evaluation time
        end_time = datetime.now()
        eval_duration = end_time - start_time
        lab.log(f"Evaluation completed in {eval_duration}")

        # Save evaluation summary
        summary_file = os.path.join(output_dir, "evaluation_summary.json")
        summary_data = {
            "evaluation_type": "EleutherAI LM Evaluation Harness",
            "model_name": model_name,
            "tasks": tasks,
            "limit": limit if limit else "all samples",
            "duration": str(eval_duration),
            "completed_at": end_time.isoformat(),
            "gpu_used": os.environ.get("CUDA_VISIBLE_DEVICES", "all"),
        }

        with open(summary_file, "w") as f:
            json.dump(summary_data, f, indent=2)

        summary_artifact_path = lab.save_artifact(summary_file, "evaluation_summary.json")
        lab.log(f"Saved evaluation summary: {summary_artifact_path}")

        lab.update_progress(95)

        # Complete the job
        lab.finish("Evaluation completed successfully!")

        return {
            "status": "success",
            "job_id": lab.job.id,
            "duration": str(eval_duration),
            "output_dir": output_dir,
            "tasks": tasks,
            "gpu_used": os.environ.get("CUDA_VISIBLE_DEVICES", "all"),
        }

    except KeyboardInterrupt:
        lab.error("Stopped by user or remotely")
        return {"status": "stopped", "job_id": lab.job.id if hasattr(lab, "job") else None}

    except Exception as e:
        error_msg = str(e)
        lab.log(f"Evaluation failed: {error_msg}")

        import traceback

        traceback.print_exc()
        lab.error(error_msg)
        return {"status": "error", "job_id": lab.job.id if hasattr(lab, "job") else None, "error": error_msg}


if __name__ == "__main__":
    import sys

    result = run_evaluation()
    print("Evaluation result:", result)
    # Same guard as the training trainer: a caught failure returned {"status":
    # "error"} but the process exited 0, so TL could mark the job COMPLETE despite
    # the eval failing. Exit non-zero on anything but success so it reads FAILED.
    if result.get("status") not in ("success", "stopped"):
        sys.exit(1)
