/**
 * Demo interceptor for every `tlFetch()` call (src/lib/tl-fetch.ts). In DEMO_MODE
 * there is no Transformer Lab backend, so this returns a canned `Response` in the
 * exact shape each caller's parser expects, matched by TL path. One coherent set
 * of experiments + jobs here drives Fine-tune, Evals, Tasks and Notes at once.
 */
import { demoJson, livingLoss, livingProgress, hoursAgo, minutesAgo } from "@/lib/demo";

const iso = (ms: number) => new Date(ms).toISOString();

const RUN_TRAINER = "local/unsloth-llm-train/train.py";
const RUN_EVAL = "eleutherai-lm-evaluation-harness/main.py";

/** The one RUNNING job, animated off the wall-clock so it visibly advances. */
function runningTrainJob() {
  const percent = livingProgress(30); // 4→96% over 30 min, loops
  return {
    id: "c653fc81-demo",
    type: "TRAIN",
    status: "RUNNING",
    progress: percent,
    job_data: {
      task_name: "learn-4b-full",
      template_name: "learn-4b-full",
      subtype: "TRAIN",
      run: RUN_TRAINER,
      model_name: "aisingapore/Gemma-SEA-LION-v4-4B-VL",
      dataset: "s3://buku-korpus/learn/v5/",
      start_time: iso(minutesAgo(42)),
      launch_progress: { percent },
      num_train_epochs: 1,
      batch_size: 2,
      learning_rate: 0.0002,
      max_steps: -1,
      lora_r: 16,
      lora_alpha: 32,
      user_info: { name: "Admin", email: "admin@rantai.ai" },
      parameters: {
        model_name: "aisingapore/Gemma-SEA-LION-v4-4B-VL",
        dataset: "s3://buku-korpus/learn/v5/",
        num_train_epochs: 1,
        batch_size: 2,
        learning_rate: 0.0002,
        max_steps: -1,
        lora_r: 16,
        lora_alpha: 32,
      },
      // a little live telemetry the log/loss panels can show
      loss: livingLoss(percent),
    },
  };
}

function trainJob(
  id: string,
  name: string,
  model: string,
  dataset: string,
  startedMinAgo: number,
  score?: string,
) {
  return {
    id,
    type: "TRAIN",
    status: "COMPLETE",
    progress: 100,
    job_data: {
      task_name: name,
      template_name: name,
      subtype: "TRAIN",
      run: RUN_TRAINER,
      model_name: model,
      output_model_name: `rantai-${name}`,
      output_model_id: id,
      dataset,
      start_time: iso(minutesAgo(startedMinAgo)),
      end_time: iso(minutesAgo(startedMinAgo - 46)),
      num_train_epochs: 1,
      batch_size: 2,
      learning_rate: 0.0002,
      max_steps: -1,
      lora_r: 16,
      lora_alpha: 32,
      user_info: { name: "Admin", email: "admin@rantai.ai" },
      ...(score ? { score } : {}),
      parameters: { model_name: model, dataset, num_train_epochs: 1, lora_r: 16, lora_alpha: 32 },
    },
  };
}

function evalJob(id: string, name: string, model: string, startedMinAgo: number, score: string) {
  return {
    id,
    type: "EVAL",
    status: "COMPLETE",
    progress: 100,
    job_data: {
      task_name: name,
      template_name: name,
      subtype: "EVAL",
      run: RUN_EVAL,
      model_name: model,
      score,
      start_time: iso(minutesAgo(startedMinAgo)),
      end_time: iso(minutesAgo(startedMinAgo - 12)),
      user_info: { name: "Admin", email: "admin@rantai.ai" },
      parameters: { model_name: model, tasks: "arc_easy,winogrande,hellaswag", limit: "0.1", dtype: "bfloat16" },
      config: { script_parameters: { tasks: "arc_easy,winogrande,hellaswag" } },
    },
  };
}

function exportJob(id: string, name: string, model: string, startedMinAgo: number) {
  return {
    id,
    type: "EXPORT",
    status: "COMPLETE",
    progress: 100,
    job_data: {
      task_name: name,
      subtype: "EXPORT",
      run: "export/merge_and_gguf.py",
      model_name: model,
      output_model_name: `${name}-gguf`,
      start_time: iso(minutesAgo(startedMinAgo)),
      end_time: iso(minutesAgo(startedMinAgo - 8)),
      user_info: { name: "Admin", email: "admin@rantai.ai" },
      artifacts: [`${name}-Q8_0.gguf`],
    },
  };
}

const SCORE_ASK = JSON.stringify([{ type: "grounded", score: 0.98 }, { type: "refusal", score: 1.0 }]);
const SCORE_AMAL = JSON.stringify([{ type: "macro_f1", score: 0.989 }, { type: "acc", score: 0.982 }]);
const SCORE_RET = JSON.stringify([{ type: "arc_easy", score: 0.769 }, { type: "winogrande", score: 0.748 }]);

function allJobs() {
  return [
    runningTrainJob(),
    trainJob("b95ccad0-demo", "ask-4b", "aisingapore/Gemma-SEA-LION-v4-4B-VL", "s3://buku-korpus/ask/v2/", 190, SCORE_ASK),
    trainJob("6dcd6da9-demo", "practice-4b", "aisingapore/Gemma-SEA-LION-v4-4B-VL", "s3://buku-korpus/practice/v1/", 260),
    trainJob("26f5f0fa-demo", "ask-8b", "aisingapore/Llama-SEA-LION-v3.5-8B-R", "s3://buku-korpus/ask/v2/", 1400, SCORE_ASK),
    trainJob("0a7acadf-demo", "amal-classifier-v4", "unsloth/Qwen2.5-3B-Instruct", "amal-malware-v4", 2600, SCORE_AMAL),
    evalJob("e17c9a20-demo", "eval-ask-grounding", "rantai-ask-4b", 120, SCORE_ASK),
    evalJob("e2f4b881-demo", "retention-amal-v4", "unsloth/Qwen2.5-3B-Instruct", 2550, SCORE_RET),
    exportJob("x9911abc-demo", "ask-4b-export", "aisingapore/Gemma-SEA-LION-v4-4B-VL", 150),
  ];
}

function localModels() {
  const m = (repo: string, arch: string, mb: number) => ({
    model_id: repo,
    name: repo.split("/").pop(),
    local_path: `/models/${repo}`,
    json_data: {
      uniqueID: repo,
      name: repo.split("/").pop(),
      architecture: arch,
      size_of_model_in_mb: mb,
      huggingface_repo: repo,
    },
  });
  return [
    m("aisingapore/Llama-SEA-LION-v3.5-8B-R", "LlamaForCausalLM", 16384),
    m("aisingapore/Gemma-SEA-LION-v4-4B-VL", "Gemma3ForConditionalGeneration", 8192),
    m("unsloth/Qwen2.5-3B-Instruct", "Qwen2ForCausalLM", 6144),
    m("aisingapore/Llama-SEA-LION-v3.5-8B-R-Q8_0-GGUF", "GGUF", 8700),
  ];
}

function datasets() {
  const d = (id: string, size: number, desc: string) => ({ dataset_id: id, size, json_data: { description: desc } });
  return [
    d("buku-korpus/ask/v2", 5_100_000, "Grounded QA (ask) — kurikulum SD/SMP/SMA"),
    d("buku-korpus/learn/v5", 9_800_000, "Guided learning (Socratic) turns"),
    d("buku-korpus/practice/v1", 1_200_000, "MCQ practice generation pairs"),
    d("amal-malware-v4", 3_400_000, "Behavioral malware classification (leakage-free)"),
  ];
}

function datasetPreview() {
  return {
    status: "OK",
    data: {
      columns: {
        instruction: [
          "Apa itu teks berita?",
          "Jelaskan Pancasila sebagai dasar negara.",
          "Sebutkan ciri-ciri teks berita.",
        ],
        output: [
          "Teks berita adalah teks yang berisi informasi tentang peristiwa aktual...",
          "Pancasila adalah dasar negara Indonesia yang terdiri dari lima sila...",
          "Ciri-ciri teks berita: faktual, aktual, objektif, dan menggunakan bahasa baku...",
        ],
      },
    },
  };
}

function providers() {
  return [
    {
      id: "56b5f6dc-demo",
      name: "local",
      type: "local",
      disabled: false,
      is_default: true,
      config: { supported_accelerators: ["NVIDIA GB10"] },
    },
  ];
}

function evalResultsScores() {
  return {
    results: {
      arc_easy: { "acc,none": 0.769, "acc_stderr,none": 0.011, "acc_norm,none": 0.742 },
      winogrande: { "acc,none": 0.748, "acc_stderr,none": 0.012 },
      hellaswag: { "acc,none": 0.712, "acc_stderr,none": 0.009, "acc_norm,none": 0.808 },
    },
    "n-samples": { arc_easy: { original: 2376, effective: 238 } },
  };
}

function evalSamplesCsv() {
  return {
    header: ["test_case_id", "score", "input", "output", "expected_output"],
    body: [
      ["q1", "1.0", "Ibukota Indonesia?", "Jakarta", "Jakarta"],
      ["q2", "1.0", "2 + 2 = ?", "4", "4"],
      ["q3", "0.0", "Presiden pertama RI?", "Soekarno-Hatta", "Soekarno"],
      ["q4", "1.0", "Warna bendera Indonesia?", "Merah putih", "Merah putih"],
    ],
  };
}

const NOTE_BODIES: Record<string, string> = {
  "note-panduan":
    "# Panduan Onboarding\n\nSelamat datang di **RantAI LLMOps**. Alur kerja: Fine-tune → Evals → Deploy.\n\n- Fine-tune adapter LoRA di atas base SEA-LION\n- Validasi via Evals (grounding + retention)\n- Deploy ke vLLM lewat Deployments\n",
  "note-arsitektur":
    "# Arsitektur\n\nLLMOps menyajikan vLLM (base + adapter). Orkestrasi (RAG, intent, follow-up) ada di sisi aplikasi.\n\n```\nklien → app → vLLM (base/ask/learn/practice)\n```\n",
};

export function demoTlResponse(pathAndQuery: string, init?: { method?: string }): Response {
  const method = (init?.method ?? "GET").toUpperCase();
  const [path, qs = ""] = pathAndQuery.split("?");
  const query = new URLSearchParams(qs);

  // Launches → a plausible queued job the UI can navigate to.
  if (path.includes("/launch")) {
    return demoJson({
      status: "WAITING",
      job_id: `demo-${Date.now().toString(36)}`,
      cluster_name: "demo-cluster",
      message: "Demo launch accepted",
    });
  }
  // Experiment create/delete + any non-GET mutation → OK.
  if (method !== "GET" || /\/(create|delete|stop|download|load|export)\b/.test(path)) {
    return demoJson({ ok: true, status: "ok", id: "rantai-ft", demo: true });
  }

  // Eval results (scores OR per-sample CSV, by file_index).
  if (path.includes("/get_eval_results")) {
    return demoJson(query.has("file_index") ? evalSamplesCsv() : evalResultsScores());
  }
  // Job logs.
  if (path.endsWith("/provider_logs")) {
    return demoJson({ logs: "[trainer] step 512 loss=0.83\n[trainer] step 513 loss=0.79\n[trainer] saving checkpoint...\n" });
  }
  if (path.endsWith("/output")) {
    return demoJson({ output: "Training started with Unsloth FastLanguageModel\nStep 512: loss=0.83\nStep 513: loss=0.79\n" });
  }
  // Notes markdown (raw JSON string).
  const noteMatch = path.match(/^\/experiment\/([^/]+)\/notes$/);
  if (noteMatch) return demoJson(NOTE_BODIES[noteMatch[1]] ?? "# Catatan\n\n(demo)\n");

  // Single job: /experiment/{exp}/jobs/{id}
  const single = path.match(/^\/experiment\/[^/]+\/jobs\/([^/]+)$/);
  if (single && !path.endsWith("/list")) {
    const job = allJobs().find((j) => String(j.id) === single[1]) ?? allJobs()[0];
    return demoJson(job);
  }
  // Jobs list (per experiment). Only rantai-ft has jobs; note-* have none.
  if (/^\/experiment\/[^/]+\/jobs\/list/.test(path)) {
    return demoJson(path.startsWith("/experiment/rantai-ft/") ? allJobs() : []);
  }
  // Experiments list — drives Fine-tune/Evals/Tasks + Notes (note-* ids).
  if (path === "/experiment/" || path === "/experiment") {
    return demoJson([
      { id: "rantai-ft", name: "rantai-ft" },
      { id: "note-panduan", name: "note-panduan" },
      { id: "note-arsitektur", name: "note-arsitektur" },
    ]);
  }
  if (path === "/model/list") return demoJson(localModels());
  if (path === "/data/list") return demoJson(datasets());
  if (path.startsWith("/data/preview")) return demoJson(datasetPreview());
  if (path.startsWith("/compute_provider/providers")) return demoJson(providers());

  // Unknown GET → empty list so no parser throws.
  return demoJson({ data: [] });
}
