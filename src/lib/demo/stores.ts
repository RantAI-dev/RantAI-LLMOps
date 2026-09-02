/**
 * DEMO fixtures for the file-store- and engine-backed features (Workflows,
 * Prompts, Compute GPU, Serve/Deployments, Evals history, Conversations, Models).
 * Shapes mirror the exported types of each source module, so the real routes/UI
 * render them unchanged. All type imports are type-only (no runtime cycle).
 */
import { daysAgo, hoursAgo, minutesAgo } from "@/lib/demo";
import type { WorkflowRun } from "@/lib/workflow-run-store";
import type { Prompt, PromptSummary } from "@/modules/prompts/types";
import type { GpuMetric } from "@/lib/gpu-metrics";
import type { ClassEvalRunSummary } from "@/lib/classification-eval-store";
import type { EvalRunSummary } from "@/lib/eval-run-store";
import type { GatewayStore } from "@/lib/gateway-store";
import type { EngineInfo } from "@/lib/inference-engines";
import type { OllamaModel } from "@/lib/ollama";

const isoMin = (n: number) => new Date(minutesAgo(n)).toISOString();

// ---------------- Workflows ----------------
export function demoWorkflowRuns(): WorkflowRun[] {
  const stages = (s: string) => [
    { key: "train", label: "Train", status: s === "failed" ? "error" : "done" },
    { key: "eval", label: "Evaluate", status: s === "failed" ? "skipped" : "done" },
    { key: "export", label: "Export", status: s === "success" ? "done" : "skipped" },
  ];
  const mk = (
    id: string,
    adaptor: string,
    base: string,
    dataset: string,
    startedMin: number,
    overall: "success" | "partial" | "failed",
    score: number | null,
  ): WorkflowRun => ({
    id,
    startedAt: isoMin(startedMin),
    finishedAt: isoMin(startedMin - 52),
    baseModel: base,
    dataset,
    adaptorName: adaptor,
    epochs: 1,
    benchmark: "arc_easy",
    coverage: 0.1,
    stages: stages(overall) as WorkflowRun["stages"],
    score,
    ggufReady: overall === "success",
    loadModelId: overall === "success" ? `rantai-${adaptor}` : null,
    trainJobId: `${id}-train`,
    overall,
    requestedStages: { eval: true, export: overall === "success" },
    cached: false,
  });
  return [
    mk("wf-1", "ask-4b", "aisingapore/Gemma-SEA-LION-v4-4B-VL", "buku-korpus/ask/v2", 180, "success", 0.98),
    mk("wf-2", "practice-4b", "aisingapore/Gemma-SEA-LION-v4-4B-VL", "buku-korpus/practice/v1", 600, "partial", 0.86),
    mk("wf-3", "amal-classifier-v4", "unsloth/Qwen2.5-3B-Instruct", "amal-malware-v4", 2600, "success", 0.989),
    mk("wf-4", "learn-8b", "aisingapore/Llama-SEA-LION-v3.5-8B-R", "buku-korpus/learn/v5", 3400, "failed", null),
  ];
}

// ---------------- Prompts (registry) ----------------
const PV = (version: number, text: string, min: number, note?: string) => ({
  version,
  text,
  createdAt: minutesAgo(min),
  ...(note ? { note } : {}),
});
export const DEMO_PROMPTS: Prompt[] = [
  {
    id: "ask-system",
    name: "ask-system",
    description: "Grounded QA — answer only from context, cite, refuse otherwise.",
    createdAt: daysAgo(21),
    updatedAt: daysAgo(2),
    tags: ["produksi", "grounded"],
    aliases: { production: 3, staging: 3 },
    versions: [
      PV(1, "Kamu tutor. Jawab dari materi.", 30240),
      PV(2, "Kamu tutor. Jawab HANYA dari materi, sertakan [Sumber].", 10080, "tambah sitasi"),
      PV(3, "Kamu tutor SEA-LION. Jawab HANYA dari konteks; jika tidak ada, tolak dengan sopan; selalu sertakan [Sumber].", 2880, "refusal tegas"),
    ],
  },
  {
    id: "learn-system",
    name: "learn-system",
    description: "Guided (Socratic) learning — explain a little, then ask.",
    createdAt: daysAgo(18),
    updatedAt: daysAgo(4),
    tags: ["produksi", "socratic"],
    aliases: { production: 2 },
    versions: [
      PV(1, "Ajari topik langkah demi langkah.", 25920),
      PV(2, "Ajari secara sokratik: jelaskan sedikit, lalu ajukan pertanyaan pengecekan, ulangi.", 5760, "loop sokratik"),
    ],
  },
  {
    id: "stem-system",
    name: "stem-system",
    description: "Step-by-step math/STEM solver ending with a clean answer line.",
    createdAt: daysAgo(9),
    updatedAt: hoursAgo(20),
    tags: ["stem", "hitungan"],
    aliases: { production: 1 },
    versions: [PV(1, "Selesaikan LANGKAH DEMI LANGKAH, periksa, akhiri 'Jawaban: ...'.", 1200)],
  },
];
export function demoPromptSummaries(): PromptSummary[] {
  return DEMO_PROMPTS.map(({ versions, ...rest }) => ({
    ...rest,
    latestVersion: versions[versions.length - 1].version,
    versionCount: versions.length,
  }));
}
export function demoPromptById(id: string): Prompt | null {
  return DEMO_PROMPTS.find((p) => p.id === id) ?? null;
}
export function demoPromptByName(name: string): Prompt | null {
  return DEMO_PROMPTS.find((p) => p.name === name) ?? null;
}

// ---------------- Compute (GPU) ----------------
export function demoGpus(): GpuMetric[] {
  return [
    { index: 0, name: "NVIDIA GB10", utilGpu: 96, memUsedMb: 68000, memTotalMb: 124518, tempC: 72, powerW: 25 },
  ];
}

// ---------------- Evals history (classification + grounding) ----------------
export function demoClassRunSummaries(): ClassEvalRunSummary[] {
  return [
    {
      id: "cls-amal-v4",
      model: "rantai-amal-classifier-v4:latest",
      systemPrompt: "Klasifikasikan sampel malware ke salah satu keluarga.",
      maxTokens: 32,
      status: "done",
      createdAt: minutesAgo(2600),
      updatedAt: minutesAgo(2585),
      total: 200,
      completed: 200,
      labels: ["Trojan", "Worm", "Ransomware", "Spyware", "Adware", "Benign"],
      errorCount: 0,
    } as ClassEvalRunSummary,
  ];
}
export function demoEvalRunSummaries(): EvalRunSummary[] {
  return [
    {
      id: "grd-ask-4b",
      model: "rantai-ask-4b:latest",
      systemPrompt: "Jawab hanya dari konteks; tolak jika tidak ada.",
      maxTokens: 256,
      status: "done",
      createdAt: minutesAgo(140),
      updatedAt: minutesAgo(128),
      total: 60,
      completed: 60,
      errorCount: 0,
    } as EvalRunSummary,
  ];
}

// ---------------- Serve / Deployments (gateway) ----------------
export function demoGateway(): GatewayStore {
  return {
    deployedModels: ["base", "ask", "learn", "practice"],
    apiKeys: [
      { id: "key-prod", name: "production", key: "rk-demo-9f2c4a1b8e6d", createdAt: daysAgo(12) },
      { id: "key-stg", name: "staging", key: "rk-demo-3a7f0c92d541", createdAt: daysAgo(5) },
    ],
  };
}

// ---------------- Serve info / Models (engines) ----------------
export function demoEngines(): EngineInfo[] {
  const served = [
    { id: "base", name: "base", isGguf: false },
    { id: "ask", name: "ask", isGguf: false },
    { id: "learn", name: "learn", isGguf: false },
    { id: "practice", name: "practice", isGguf: false },
  ];
  return [
    {
      id: "vllm",
      label: "vLLM",
      v1BaseUrl: "http://vllm:8000/v1",
      configured: true,
      available: true,
      loaded: "base",
      baseModel: "aisingapore/Gemma-SEA-LION-v4-4B-VL",
      models: served,
    },
    {
      id: "ollama",
      label: "Ollama",
      v1BaseUrl: "http://localhost:11434/v1",
      configured: true,
      available: true,
      loaded: "rantai-sealion-v3-ask:latest",
      baseModel: "rantai-sealion-v3-ask:latest",
      models: [
        { id: "rantai-sealion-v3-ask:latest", name: "rantai-sealion-v3-ask:latest", isGguf: true },
        { id: "qwen2.5:3b-instruct", name: "qwen2.5:3b-instruct", isGguf: true },
      ],
    },
  ];
}
export function demoOllamaModels(): OllamaModel[] {
  return [
    { id: "rantai-sealion-v3-ask:latest", name: "rantai-sealion-v3-ask:latest", sizeMb: 8700 },
    { id: "qwen2.5:3b-instruct", name: "qwen2.5:3b-instruct", sizeMb: 6144 },
    { id: "rantai-amal-classifier-v4:latest", name: "rantai-amal-classifier-v4:latest", sizeMb: 6100 },
  ];
}

// ---------------- Conversations (Interact history) ----------------
export function demoConversations(): unknown[] {
  return [
    { id: "conv-1", name: "Contoh: teks berita", title: "Contoh: teks berita", created_at: minutesAgo(30), updated_at: minutesAgo(28), messages: [] },
    { id: "conv-2", name: "Contoh: soal SPLDV", title: "Contoh: soal SPLDV", created_at: hoursAgo(3), updated_at: hoursAgo(3), messages: [] },
  ];
}
