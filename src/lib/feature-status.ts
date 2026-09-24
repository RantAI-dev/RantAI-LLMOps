/**
 * Single source of truth for how each UI feature relates to the real backend.
 *
 *  - "live"       : backed by a real backend endpoint (works end-to-end)
 *  - "simplified" : partially real; UI trimmed to match what the backend can do
 *  - "mock"       : no backend support today — shown for design/demo only
 *  - "planned"    : backend supports it, UI not built yet
 *
 * Two rules keep this file honest:
 *
 *  1. Every key names ONE WIDGET, never a whole page. A page whose data comes
 *     from a real endpoint is live even when a card inside it is still mock.
 *  2. Nothing here is rendered yet. `MockBadge` / `MockBanner` exist in
 *     `src/components/ui/` but are used in zero pages, so these labels are
 *     developer notes only — they never reach the user and never gate anything.
 *     Verified 24 September 2026.
 */
export type FeatureStatus = "live" | "simplified" | "mock" | "planned";

export const FEATURE_STATUS = {
  // --- Deployments (/serve) — the PAGE is live: it probes engines, deploys
  // vLLM, manages LoRA adapters and gateway keys through /api/serve/*,
  // /api/adapters. An engine reading "Unreachable" means the engine is down or
  // unconfigured (VLLM_BASE_URL unset) — a true probe result, not a mock.
  "serve.engines": "live",
  "serve.vllmDeploy": "live",
  "serve.adapters": "live",
  "serve.gatewayKeys": "live",

  // --- Model Registry (/models) — the PAGE is live: the catalog comes from
  // /api/models/catalog, and it is what feeds the vLLM deploy model picker.
  // "Total Models 0" means the backend catalog is empty, not that the page is
  // fake. The per-model analytics placeholders were REMOVED on 24 Sep 2026.
  "model.catalog": "live",

  // --- Tasks (/tasks) — the PAGE is live: real jobs from /api/tasks/list and
  // real logs from /api/tasks/{id}/output. The resource-monitor and
  // cost-estimate placeholders were never rendered and are gone (24 Sep 2026).
  "task.list": "live",
  "task.logs": "live",

  // --- Datasets (/datasets) — the PAGE is live: list, preview, Hugging Face
  // download and local upload all work via /api/datasets/*. The "Used by N
  // workflows" line and its usage sort were REMOVED on 24 Sep 2026.
  "dataset.list": "live",
  "dataset.preview": "live",
  "dataset.upload": "live",

  // Interact — real chat playground: the UI streams from an OpenAI-compatible
  // engine (Ollama / llama.cpp / vLLM) via our `/api/chat` BFF.
  "chat.playground": "live",

  // Fine-tune — real LoRA training: submit a job, watch it live, and the
  // adaptor appears in the model picker's Fine-tuned tab. Via `/api/finetune/*`.
  "finetune.train": "live",

  // Evals — real benchmark accuracy via the EleutherAI LM-Eval-Harness plugin.
  // Through `/api/evals/*`.
  "eval.run": "live",

  // Prompt Registry — versioned prompt management (versions, aliases, tags,
  // diff, export) backed by a server-side file store. Through `/api/prompts/*`.
  "prompts.registry": "live",

  // Traces — per-request record of chat inference (model, engine, tokens,
  // latency), read from the real inference log. Through `/api/traces`.
  "observability.traces": "live",
} as const satisfies Record<string, FeatureStatus>;


export type FeatureKey = keyof typeof FEATURE_STATUS;

export function getFeatureStatus(key: FeatureKey): FeatureStatus {
  return FEATURE_STATUS[key];
}

export function isMock(key: FeatureKey): boolean {
  // Widen before comparing: no entry is "mock" today, so a direct comparison is
  // a compile error. The helper stays so a future mock feature is one edit away.
  return (FEATURE_STATUS[key] as FeatureStatus) === "mock";
}

/**
 * Sidebar menu label -> feature key, so the nav can render a red dot for menus
 * that are still mock. Labels must match `mainNav` / `workspaceNav` in the shell.
 */
export const NAV_FEATURE: Partial<Record<string, FeatureKey>> = {
  // No menus are mock-gated in the sidebar — every page reads a real endpoint.
  // (Add an entry here to flag a future mock menu.)
};

export function isNavMock(label: string): boolean {
  const key = NAV_FEATURE[label];
  return key ? isMock(key) : false;
}
