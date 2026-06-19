/**
 * Single source of truth for how each UI feature relates to the real backend
 * (Transformer Lab). We keep "mock" features visible in the UI on purpose, but
 * mark them clearly so nobody mistakes a demo screen for a working feature.
 *
 *  - "live"       : backed by a real Transformer Lab endpoint (works / will work end-to-end)
 *  - "simplified" : partially real; UI trimmed to match what the backend can actually do
 *  - "mock"       : no backend support today — shown for design/demo only ("fantasi")
 *  - "planned"    : backend supports it, UI not built yet
 *
 * Only "mock" gets the red marking treatment (badge / banner / sidebar dot).
 */
export type FeatureStatus = "live" | "simplified" | "mock" | "planned";

export const FEATURE_STATUS = {
  // RAG suite — TL `documents` is plain file storage: no embeddings, vector store,
  // retrieval, or DeepEval. Everything below is UI-only for now.
  "rag.documents": "mock",
  "rag.index": "mock",
  "rag.interact": "mock",
  "rag.evals": "mock",

  // Model Registry — TL has no serving/deploy orchestration or per-model traffic
  // analytics. Inference in TL = launch a job (vLLM/Ollama) and read its tunnel URL.
  "model.deployment": "mock",
  "model.usage": "mock",
  "model.evaluation": "mock",

  // Tasks — TL exposes no realtime GPU metrics and no per-job cost estimate.
  "task.resourceMonitor": "mock",
  "task.costEstimate": "mock",

  // Datasets — TL has no quality scanner (PII/toxic/score) and no DB/API/Cloud
  // connectors (only file upload + Hugging Face download).
  "dataset.qualityScan": "mock",
  "dataset.externalSources": "mock",

  // Interact — real chat playground: the UI streams from an OpenAI-compatible
  // engine (Ollama / llama.cpp / vLLM / Transformer Lab) via our `/api/chat` BFF.
  "chat.playground": "live",

  // Fine-tune — real LoRA training via TL's `llama_trainer` plugin: submit a
  // job, watch it live, and the adaptor appears in the model picker's
  // Fine-tuned tab (loadable for inference). All through `/api/finetune/*`.
  "finetune.train": "live",
} as const satisfies Record<string, FeatureStatus>;

export type FeatureKey = keyof typeof FEATURE_STATUS;

export function getFeatureStatus(key: FeatureKey): FeatureStatus {
  return FEATURE_STATUS[key];
}

export function isMock(key: FeatureKey): boolean {
  return FEATURE_STATUS[key] === "mock";
}

/**
 * Sidebar menu label -> feature key, so the nav can render a red dot for menus
 * that are still mock. Labels must match `mainNav` / `workspaceNav` in the shell.
 */
export const NAV_FEATURE: Partial<Record<string, FeatureKey>> = {
  // Interact is now a real chat playground (chat.playground = "live") — no red dot.
  Evals: "rag.evals",
  Documents: "rag.documents",
};

export function isNavMock(label: string): boolean {
  const key = NAV_FEATURE[label];
  return key ? isMock(key) : false;
}
