/**
 * GB10 container-launcher for "Deploy vLLM". On GB10 (Blackwell / aarch64) pip
 * vLLM has no working build (validated 2026-09-01), so the reliable path is the
 * pre-built vLLM container — the exact way this box's production 4B already runs.
 *
 * This runs a vLLM container (base + LoRA adapters) via the local Docker socket
 * (src/lib/docker-client). It is used when SERVE_LAUNCHER=container and the
 * socket is mounted; otherwise the portable TL-provider launcher (serve-vllm) is
 * used. The container spec mirrors the manually-validated rantai-vllm setup.
 */
import { dockerAvailable, dockerConnectNetwork, dockerCreate, dockerInspect, dockerPull, dockerRemove, dockerStart, dockerStop } from "@/lib/docker-client";
import { getHfToken } from "@/lib/settings-store";
import { clearVllmDeployment, readVllmDeployment, writeVllmDeployment, type VllmDeployment } from "@/lib/vllm-deployment-store";
import type { DeployVllmParams, VllmDeploymentStatus } from "@/lib/serve-vllm";

const IMAGE = process.env.VLLM_IMAGE ?? "vllm/vllm-openai:cu130-nightly";
const CONTAINER = process.env.VLLM_MANAGED_NAME ?? "rantai-vllm-managed";
const NETWORK = process.env.VLLM_NETWORK ?? "rantai-llmops_llmops";
const ALIAS = process.env.VLLM_ALIAS ?? "vllm-managed";
const HF_CACHE_VOL = process.env.VLLM_HF_CACHE_VOLUME ?? "rantai-llmops_vllm_hf_cache";
const TL_DATA_VOL = process.env.VLLM_TL_DATA_VOLUME ?? "rantai-llmops_tl_data";
/** vLLM listens on 8000 in the image; consumers reach it at ALIAS:8000. */
const SERVE_PORT = 8000;

/** Entrypoint that assembles `vllm serve …`, adding LoRA flags only when adapters
 *  are present — the same script the box's production vLLM container uses. */
const ENTRYPOINT_SCRIPT = [
  "set -eu",
  'set -- "$VLLM_MODEL" --served-model-name "$VLLM_SERVED_NAME"',
  ' --gpu-memory-utilization "$VLLM_GPU_UTIL" --max-model-len "$VLLM_MAX_MODEL_LEN"',
  " --enforce-eager --max-num-seqs 16 --trust-remote-code",
  'if [ -n "${VLLM_QUANT:-}" ]; then set -- "$@" --quantization "$VLLM_QUANT"; fi',
  'if [ -n "${VLLM_LORA_MODULES:-}" ]; then set -- "$@" --enable-lora --max-loras "${VLLM_MAX_LORAS:-4}" --max-lora-rank "${VLLM_MAX_LORA_RANK:-16}" --lora-modules $VLLM_LORA_MODULES; fi',
  'exec vllm serve "$@"',
].join("\n");

export function containerLauncherAvailable(): boolean {
  return dockerAvailable();
}

export async function deployVllmContainer(p: DeployVllmParams): Promise<VllmDeployment> {
  if (!dockerAvailable()) {
    throw new Error("Docker socket not available — mount DOCKER_SOCKET to use the container launcher.");
  }
  if (!p.baseModel) throw new Error("baseModel is required");
  const servedName = p.servedName || "base";
  const adapters = p.adapters ?? [];
  const env = [
    `VLLM_MODEL=${p.baseModel}`,
    `VLLM_SERVED_NAME=${servedName}`,
    `VLLM_GPU_UTIL=${p.gpuUtil || "0.30"}`,
    `VLLM_MAX_MODEL_LEN=${p.maxModelLen || "8192"}`,
    `VLLM_QUANT=${p.quant || ""}`,
    `VLLM_LORA_MODULES=${adapters.map((a) => `${a.name}=${a.path}`).join(" ")}`,
    `VLLM_MAX_LORAS=4`,
    `VLLM_MAX_LORA_RANK=16`,
    `VLLM_ALLOW_RUNTIME_LORA_UPDATING=True`,
  ];
  const hf = await getHfToken();
  if (hf) env.push(`HF_TOKEN=${hf}`);

  const config = {
    Image: IMAGE,
    Entrypoint: ["/bin/sh", "-c", ENTRYPOINT_SCRIPT],
    Cmd: [] as string[],
    Env: env,
    ExposedPorts: { [`${SERVE_PORT}/tcp`]: {} },
    HostConfig: {
      Binds: [`${HF_CACHE_VOL}:/root/.cache/huggingface`, `${TL_DATA_VOL}:/root/.transformerlab:ro`],
      NetworkMode: NETWORK,
      IpcMode: "host",
      RestartPolicy: { Name: "unless-stopped" },
      DeviceRequests: [{ Driver: "nvidia", Count: -1, Capabilities: [["gpu"]] }],
    },
    NetworkingConfig: { EndpointsConfig: { [NETWORK]: { Aliases: [ALIAS] } } },
  };

  // Ensure the image is present, then recreate the managed container.
  await dockerPull(IMAGE).catch(() => {}); // best-effort; likely already local
  await dockerStop(CONTAINER).catch(() => {});
  await dockerRemove(CONTAINER).catch(() => {});
  const created = await dockerCreate(CONTAINER, config);
  if (created.status !== 201) {
    const detail = (created.json as { message?: string })?.message || created.text.slice(0, 300);
    throw new Error(`Container create failed (${created.status}): ${detail}`);
  }
  const id = (created.json as { Id?: string })?.Id ?? CONTAINER;
  // NetworkingConfig on create attaches the network; connect is a belt-and-braces
  // fallback if the create-time attach was skipped.
  await dockerConnectNetwork(NETWORK, id, [ALIAS]).catch(() => {});
  const started = await dockerStart(CONTAINER);
  if (started.status !== 204 && started.status !== 304) {
    throw new Error(`Container start failed (${started.status}): ${started.text.slice(0, 200)}`);
  }

  const dep: VllmDeployment = {
    launcher: "container",
    jobId: "",
    containerName: CONTAINER,
    baseModel: p.baseModel,
    servedName,
    port: SERVE_PORT,
    gpuUtil: p.gpuUtil || "0.30",
    maxModelLen: p.maxModelLen || "8192",
    quant: p.quant || "",
    adapters,
    deployedAt: Date.now(),
  };
  await writeVllmDeployment(dep);
  return dep;
}

export async function statusVllmContainer(dep: VllmDeployment): Promise<VllmDeploymentStatus> {
  let status = "UNKNOWN";
  try {
    const res = await dockerInspect(dep.containerName || CONTAINER);
    if (res.status === 200) {
      const st = (res.json as { State?: { Status?: string } })?.State?.Status ?? "unknown";
      status = st.toUpperCase(); // RUNNING / EXITED / …
    } else if (res.status === 404) {
      status = "NONE";
    }
  } catch {
    /* leave UNKNOWN */
  }
  return { deployment: dep, status, servedUrl: `http://${ALIAS}:${dep.port}/v1` };
}

export async function stopVllmContainer(): Promise<boolean> {
  const dep = await readVllmDeployment();
  const name = dep?.containerName || CONTAINER;
  let ok = false;
  try {
    await dockerStop(name).catch(() => {});
    const r = await dockerRemove(name);
    ok = r.status === 204 || r.status === 200 || r.status === 404;
  } catch {
    ok = false;
  }
  await clearVllmDeployment();
  return ok;
}
