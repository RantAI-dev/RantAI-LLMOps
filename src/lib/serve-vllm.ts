/**
 * "Deploy vLLM" — the PORTABLE serving control plane. It launches the
 * `plugins/vllm-serve` task through TL's compute provider (the SAME layer used
 * for training, `launchProviderTask`), so it runs wherever TL runs — no
 * Portainer / docker.sock. When TL is replaced by the Rust backend later, only
 * the provider implementation swaps; this module and the UI stay unchanged.
 */
import { FINETUNE_EXPERIMENT } from "@/lib/tl-constants";
import { launchProviderTask } from "@/lib/tl-provider";
import { createTlExperiment, resolveJobExperiment } from "@/lib/tasks-server";
import { tlFetch } from "@/lib/tl-fetch";
import { getHfToken } from "@/lib/settings-store";
import {
  clearVllmDeployment,
  readVllmDeployment,
  writeVllmDeployment,
  type VllmAdapter,
  type VllmDeployment,
} from "@/lib/vllm-deployment-store";

const SERVE_GITHUB_URL = "https://github.com/RantAI-dev/RantAI-LLMOps";
const SERVE_GITHUB_DIR = "plugins/vllm-serve";
const SERVE_RUN = "python vllm-serve/run.py";
// Isolate vLLM in its own venv (its deps are heavy and conflict with the
// trainer's) — mirrors the stock interactive-vllm plugin; run.py prefers it.
const SERVE_SETUP = [
  `if ! command -v uv >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh; fi`,
  `export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"`,
  `uv venv ~/vllm-venv --seed --python 3.11`,
  `. ~/vllm-venv/bin/activate`,
  `uv pip install "vllm>=0.13.0" "transformers>=4.57.3"`,
].join("\n");

export type DeployVllmParams = {
  baseModel: string;
  servedName?: string;
  adapters?: VllmAdapter[];
  gpuUtil?: string;
  maxModelLen?: string;
  quant?: string;
  port?: number;
};

/** Launch a vLLM serving task (base + optional LoRA adapters) via the provider. */
export async function deployVllm(p: DeployVllmParams): Promise<VllmDeployment> {
  if (!p.baseModel) throw new Error("baseModel is required");
  const experiment = await createTlExperiment(FINETUNE_EXPERIMENT);
  const servedName = p.servedName || "base";
  const port = p.port ?? 8001;
  const adapters = p.adapters ?? [];

  const env: Record<string, string> = {
    PYTHONUNBUFFERED: "1",
    MODEL_NAME: p.baseModel,
    VLLM_SERVED_NAME: servedName,
    VLLM_PORT: String(port),
    VLLM_GPU_UTIL: p.gpuUtil || "0.30",
    VLLM_MAX_MODEL_LEN: p.maxModelLen || "8192",
    VLLM_QUANT: p.quant || "",
    VLLM_LORA_MODULES: adapters.map((a) => `${a.name}=${a.path}`).join(" "),
    VLLM_MAX_LORAS: "4",
    VLLM_MAX_LORA_RANK: "16",
  };
  const hf = await getHfToken();
  if (hf) env.HF_TOKEN = hf;

  const jobId = await launchProviderTask({
    experimentId: experiment,
    taskName: "vllm-serve",
    run: SERVE_RUN,
    setup: SERVE_SETUP,
    githubRepoUrl: SERVE_GITHUB_URL,
    githubRepoDir: SERVE_GITHUB_DIR,
    accelerators: "NVIDIA:1",
    parameters: {}, // config is passed via env (run.py reads os.environ)
    envVars: env,
    minutesRequested: 100_000, // a serve task runs indefinitely
    description:
      `Serve ${p.baseModel} (${servedName})` + (adapters.length ? ` + ${adapters.length} adapter(s)` : ""),
    subtype: "SERVE",
  });

  const dep: VllmDeployment = {
    jobId,
    baseModel: p.baseModel,
    servedName,
    port,
    gpuUtil: env.VLLM_GPU_UTIL,
    maxModelLen: env.VLLM_MAX_MODEL_LEN,
    quant: env.VLLM_QUANT,
    adapters,
    deployedAt: Date.now(),
  };
  await writeVllmDeployment(dep);
  return dep;
}

export type VllmDeploymentStatus = {
  deployment: VllmDeployment | null;
  /** TL job status: WAITING | RUNNING | COMPLETE | FAILED | STOPPED | NONE | UNKNOWN. */
  status: string;
  /** Where consumers (gateway / Playground) can reach the served API. */
  servedUrl: string | null;
};

/** The serve task runs in the TL backend env; consumers reach it at that host + port. */
function servedUrlFor(dep: VllmDeployment): string {
  const tl = process.env.INFERENCE_BASE_URL ?? "http://localhost:8338/v1";
  let host = "localhost";
  try {
    host = new URL(tl).hostname;
  } catch {
    /* keep default */
  }
  return `http://${host}:${dep.port}/v1`;
}

export async function getVllmDeploymentStatus(): Promise<VllmDeploymentStatus> {
  const dep = await readVllmDeployment();
  if (!dep) return { deployment: null, status: "NONE", servedUrl: null };
  let status = "UNKNOWN";
  try {
    const exp = await resolveJobExperiment(dep.jobId);
    const res = await tlFetch(
      `/experiment/${encodeURIComponent(exp)}/jobs/${encodeURIComponent(dep.jobId)}`
    );
    if (res.ok) {
      const j = (await res.json()) as { status?: string; job_data?: { status?: string } };
      status = j.status || j.job_data?.status || "UNKNOWN";
    }
  } catch {
    /* leave UNKNOWN */
  }
  return { deployment: dep, status, servedUrl: servedUrlFor(dep) };
}

/** Stop the running serve task and forget the deployment. */
export async function stopVllmDeployment(): Promise<boolean> {
  const dep = await readVllmDeployment();
  if (!dep) return true;
  let ok = false;
  try {
    const exp = await resolveJobExperiment(dep.jobId);
    const res = await tlFetch(
      `/experiment/${encodeURIComponent(exp)}/jobs/${encodeURIComponent(dep.jobId)}/stop`
    );
    ok = res.ok;
  } catch {
    ok = false;
  }
  await clearVllmDeployment();
  return ok;
}
