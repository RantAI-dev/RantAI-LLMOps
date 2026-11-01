/**
 * "Deploy SGLang" — a managed SGLang container (base + LoRA adapters) through
 * the local Docker socket, the same shape as the vLLM container launcher
 * (serve-vllm-container.ts). SGLang has no portable TL-provider path here, so it
 * needs SERVE_LAUNCHER=container and a mounted socket.
 *
 * Validated on the GB10 box (2026-11-01) with Qwen-SEA-LION-v4-8B-VL + the
 * ask/learn/practice adapters. Two differences from vLLM shape the entrypoint:
 * - Unsloth saves an adapter's `target_modules` as a regex string, which SGLang
 *   rejects. The entrypoint copies each adapter into the container and lists the
 *   modules its weights actually hold; the shared adapter stays untouched (vLLM
 *   reads the same files).
 * - `--mem-fraction-static` is a share of the GPU memory that is FREE when the
 *   container starts, not of the total.
 * Clients pick an adapter by name as with vLLM; inference-engines.ts rewrites it
 * to SGLang's `<base>:<adapter>` form.
 */
import { dockerAvailable, dockerConnectNetwork, dockerCreate, dockerInspect, dockerPull, dockerRemove, dockerStart, dockerStop } from "@/lib/docker-client";
import { getHfToken } from "@/lib/settings-store";
import { createDeploymentStore, type VllmDeployment } from "@/lib/vllm-deployment-store";
import type { DeployVllmParams, VllmDeploymentStatus } from "@/lib/serve-vllm";

// GB10 (CUDA 13 driver, aarch64) needs a cu13 build, e.g.
// lmsysorg/sglang:dev-cu13-qwen38-27b-dflash2; the default suits x86 + CUDA 12.
const IMAGE = process.env.SGLANG_IMAGE ?? "lmsysorg/sglang:latest";
const CONTAINER = process.env.SGLANG_MANAGED_NAME ?? "rantai-sglang-managed";
const NETWORK = process.env.SGLANG_NETWORK ?? process.env.VLLM_NETWORK ?? "rantai-llmops_llmops";
const ALIAS = process.env.SGLANG_ALIAS ?? "sglang-managed";
const HF_CACHE_VOL = process.env.SGLANG_HF_CACHE_VOLUME ?? process.env.VLLM_HF_CACHE_VOLUME ?? "rantai-llmops_vllm_hf_cache";
const TL_DATA_VOL = process.env.SGLANG_TL_DATA_VOLUME ?? process.env.VLLM_TL_DATA_VOLUME ?? "rantai-llmops_tl_data";
/** SGLang listens on 30000 in the container; consumers reach it at ALIAS:30000. */
const SERVE_PORT = 30000;

const store = createDeploymentStore("sglang-deployment.json", "sglang-deployment");
export const readSglangDeployment = store.read;

/** Adapter names become directory names and the `<base>:<name>` model suffix. */
const ADAPTER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Rewrites a regex-string `target_modules` into the module list its weights hold. */
const PREPARE_ADAPTERS = [
  "import json, os, shutil",
  "for spec in os.environ.get('SGLANG_LORA_MODULES', '').split():",
  "    name, src = spec.split('=', 1)",
  "    dst = '/tmp/loras/' + name",
  "    shutil.copytree(src, dst, dirs_exist_ok=True)",
  "    cfg_path = os.path.join(dst, 'adapter_config.json')",
  "    cfg = json.load(open(cfg_path))",
  "    tm = cfg.get('target_modules')",
  "    if isinstance(tm, str) and tm not in ('all', 'all-linear'):",
  "        from safetensors import safe_open",
  "        keys = safe_open(os.path.join(dst, 'adapter_model.safetensors'), 'pt').keys()",
  "        cfg['target_modules'] = sorted({k.split('.lora_')[0].rsplit('.', 1)[-1] for k in keys if '.lora_' in k})",
  "        json.dump(cfg, open(cfg_path, 'w'))",
  "    print('adapter', name, 'target_modules', cfg.get('target_modules'), flush=True)",
].join("\n");

/** The container's entrypoint: prepare the adapters, then `sglang.launch_server`. */
export const SGLANG_ENTRYPOINT = [
  "set -eu",
  "python3 - <<'PY'",
  PREPARE_ADAPTERS,
  "PY",
  'set -- --model-path "$SGLANG_MODEL" --served-model-name "$SGLANG_SERVED_NAME" --host 0.0.0.0 --port 30000 \\',
  '  --mem-fraction-static "$SGLANG_MEM_FRACTION" --context-length "$SGLANG_CONTEXT_LENGTH" \\',
  "  --max-running-requests 8 --trust-remote-code --enable-metrics",
  'if [ -n "${SGLANG_QUANT:-}" ]; then set -- "$@" --quantization "$SGLANG_QUANT"; fi',
  'if [ -n "${SGLANG_LORA_MODULES:-}" ]; then',
  '  set -- "$@" --enable-lora --lora-paths',
  '  for spec in $SGLANG_LORA_MODULES; do set -- "$@" "${spec%%=*}=/tmp/loras/${spec%%=*}"; done',
  "fi",
  'exec python3 -m sglang.launch_server "$@"',
].join("\n");

/** The container env for a deployment (pure, so it is testable). */
export function sglangEnv(p: DeployVllmParams): string[] {
  const adapters = p.adapters ?? [];
  for (const a of adapters) {
    if (!ADAPTER_NAME.test(a.name)) throw new Error(`Invalid adapter name "${a.name}" (letters, digits, . _ - only).`);
    if (!a.path || /\s/.test(a.path)) throw new Error(`Adapter "${a.name}" needs a path without spaces.`);
  }
  return [
    `SGLANG_MODEL=${p.baseModel}`,
    `SGLANG_SERVED_NAME=${p.servedName || "base"}`,
    `SGLANG_MEM_FRACTION=${p.gpuUtil || "0.38"}`,
    `SGLANG_CONTEXT_LENGTH=${p.maxModelLen || "8192"}`,
    `SGLANG_QUANT=${p.quant || ""}`,
    `SGLANG_LORA_MODULES=${adapters.map((a) => `${a.name}=${a.path}`).join(" ")}`,
  ];
}

export function sglangLauncherAvailable(): boolean {
  return process.env.SERVE_LAUNCHER === "container" && dockerAvailable();
}

export async function deploySglang(p: DeployVllmParams): Promise<VllmDeployment> {
  if (!sglangLauncherAvailable()) {
    throw new Error("SGLang deploys need the container launcher: set SERVE_LAUNCHER=container and mount DOCKER_SOCKET.");
  }
  if (!p.baseModel) throw new Error("baseModel is required");
  const servedName = p.servedName || "base";
  if (servedName.includes(":")) throw new Error("The served name cannot contain ':'.");
  const env = sglangEnv(p);
  const hf = await getHfToken();
  if (hf) env.push(`HF_TOKEN=${hf}`);

  const config = {
    Image: IMAGE,
    Entrypoint: ["/bin/bash", "-c", SGLANG_ENTRYPOINT],
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

  await dockerPull(IMAGE).catch(() => {}); // best-effort; likely already local
  await dockerStop(CONTAINER).catch(() => {});
  await dockerRemove(CONTAINER).catch(() => {});
  const created = await dockerCreate(CONTAINER, config);
  if (created.status !== 201) {
    const detail = (created.json as { message?: string })?.message || created.text.slice(0, 300);
    throw new Error(`Container create failed (${created.status}): ${detail}`);
  }
  const id = (created.json as { Id?: string })?.Id ?? CONTAINER;
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
    gpuUtil: p.gpuUtil || "0.38",
    maxModelLen: p.maxModelLen || "8192",
    quant: p.quant || "",
    adapters: p.adapters ?? [],
    deployedAt: Date.now(),
  };
  await store.write(dep);
  return dep;
}

export async function getSglangDeploymentStatus(): Promise<VllmDeploymentStatus> {
  const dep = await store.read();
  if (!dep) return { deployment: null, status: "NONE", servedUrl: null };
  let status = "UNKNOWN";
  try {
    const res = await dockerInspect(dep.containerName || CONTAINER);
    if (res.status === 200) status = ((res.json as { State?: { Status?: string } })?.State?.Status ?? "unknown").toUpperCase();
    else if (res.status === 404) status = "NONE";
  } catch {
    /* leave UNKNOWN */
  }
  return { deployment: dep, status, servedUrl: `http://${ALIAS}:${dep.port}/v1` };
}

export async function stopSglangDeployment(): Promise<boolean> {
  const dep = await store.read();
  const name = dep?.containerName || CONTAINER;
  let ok = false;
  try {
    await dockerStop(name).catch(() => {});
    const r = await dockerRemove(name);
    ok = r.status === 204 || r.status === 200 || r.status === 404;
  } catch {
    ok = false;
  }
  await store.clear();
  return ok;
}
