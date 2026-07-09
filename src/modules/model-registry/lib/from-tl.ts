import type { RegistryModel } from "@/modules/model-registry/types";

/**
 * Map a real Transformer Lab catalog model (from `/api/models/catalog`) into the
 * registry's rich `RegistryModel` shape.
 *
 * REAL fields come from TL: id, name, format, size, on-disk path, quantization.
 * The deployment / usage / evaluation / audit sub-objects have NO TL backend
 * (see `feature-status`: model.deployment/usage/evaluation = "mock"), so they
 * stay zeroed defaults — the detail drawer's analytics remain demo-only.
 */

type TlCatalogModel = {
  id: string;
  name: string;
  architecture: string;
  sizeMb: number | null;
  isGguf: boolean;
  downloaded: boolean;
  hfRepo?: string;
  localPath?: string;
};

/**
 * Best-effort parameter count from an HF model name ("Qwen2.5-3B-Instruct" ->
 * "3B", "Llama-3.2-1B" -> "1B", "qwen2.5:0.5b" -> "0.5B"), else "—".
 *
 * Our fine-tune tags ("rantai-…", legacy "nqr-…") slugify the base name, which mangles the size
 * ambiguously — "qwen3-1-7b" reads as 1.7B, but "llama-3-8b" would read as 3.8B
 * (it's 8B), and the plain regex misreads "qwen3-1-7b" as 7B. There's no reliable
 * way to recover it from the slug, so we don't guess: an honest "—" beats a
 * confidently-wrong number.
 */
export function paramSizeFromName(name: string): string {
  if (/^(rantai|nqr)-/i.test(name)) return "—";
  // Accept a size token whose "b" isn't glued to another alphanumeric (so a quant
  // like ":Q4_K_M" or a repo word can't be misread as a parameter count).
  const m = name.match(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/i);
  return m ? `${m[1]}B` : "—";
}

function formatSize(sizeMb: number | null): string {
  if (sizeMb == null || sizeMb <= 0) return "—";
  return sizeMb >= 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : `${Math.round(sizeMb)} MB`;
}

export function tlToRegistryModel(m: TlCatalogModel, now: string): RegistryModel {
  // Our served fine-tunes are Ollama tags prefixed "rantai-" (legacy "nqr-"); the
  // Compare/registry code discriminates on the same prefix. The old
  // "TransformerLab/" check never matched a servable id, so the fine-tuned
  // author/tag was never applied.
  const isFineTuned = /^(rantai|nqr)-/.test(m.id);
  return {
    id: m.id,
    modelName: m.name,
    provider: "Local",
    repoId: m.hfRepo ?? m.id,
    repoUrl: m.hfRepo ? `https://huggingface.co/${m.hfRepo}` : null,
    author: isFineTuned ? "Internal ML Team" : "Hugging Face",
    task: "Chat",
    libraryName: m.isGguf ? "llama.cpp" : "transformers",
    modelFormat: m.isGguf ? "GGUF" : "Safetensors",
    parameterSize: paramSizeFromName(m.name),
    contextLength: 8192,
    license: "—",
    language: ["English"],
    tags: [m.isGguf ? "gguf" : "safetensors", ...(isFineTuned ? ["fine-tuned"] : [])],
    accessType: "Private",
    importMode: null,
    revision: "main",
    commitSha: null,
    localPath: m.localPath ?? null,
    totalModelSize: formatSize(m.sizeMb),
    status: "Available",
    owner: "AI Team",
    compatibilityStatus: m.isGguf ? "Need Review" : "Transformers Compatible",
    deploymentReadiness: "Ready",
    vllmCompatible: m.isGguf ? "No" : "Yes",
    transformersCompatible: m.isGguf ? "No" : "Yes",
    requiresTrustRemoteCode: false,
    quantization: m.isGguf ? "GGUF (4-bit)" : null,
    minVramRequired: "—",
    recommendedGpu: "—",
    gpuCountRequired: 1,
    supportsStreaming: true,
    supportsChatTemplate: true,
    createdAt: now,
    updatedAt: now,
    huggingFaceSource: null,
    files: [],
    compatibilityChecklist: {
      accessValid: true,
      licenseReviewed: false,
      configAvailable: true,
      tokenizerAvailable: true,
      modelFilesAvailable: m.downloaded,
      vllmSupported: !m.isGguf,
      hardwareChecked: false,
    },
    // --- Fantasy (no TL backend) — kept as zeroed defaults ---
    deployment: {
      environment: "Development",
      servingEngine: m.isGguf ? "Custom" : "vLLM",
      endpointUrl: "",
      gpuCluster: "",
      replica: 0,
      status: "Not Deployed",
      lastDeployment: null,
      rollbackVersion: null,
    },
    evaluation: {
      evaluationDataset: "—",
      accuracy: 0,
      hallucinationRate: 0,
      safetyScore: 0,
      latencyMs: 0,
      costEstimate: "—",
      lastEvaluationRun: null,
    },
    usage: {
      totalRequests: 0,
      successRate: 0,
      errorRate: 0,
      averageLatencyMs: 0,
      tokenUsage: 0,
      estimatedCost: "$0.00",
      gpuUtilization: 0,
      activeEndpoint: null,
    },
    auditLogs: [
      {
        id: `audit-${m.id}`,
        modelId: m.id,
        action: "Discovered in Transformer Lab",
        actor: "System",
        timestamp: now,
        status: "Info",
        notes: "Model found on disk via Transformer Lab.",
      },
    ],
  };
}
