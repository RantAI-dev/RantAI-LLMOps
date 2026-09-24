/**
 * Realtime GPU telemetry via `nvidia-smi` on the backend host — the live
 * complement to compute-server's one-off inventory. Powers the Compute page +
 * training monitor so a user can watch GPU utilization / VRAM / temp / power
 * while a job runs.
 *
 * It also reports WHY there are no GPUs, which matters more than it sounds. On
 * 24 Sep the GB10's device cgroup access was revoked for every container: the
 * device nodes were still there and readable, but opening them failed, so
 * nvidia-smi answered "Failed to initialize NVML" and every NEW job died with
 * "No CUDA GPUs are available" while vLLM — which already held its handles —
 * kept serving. Nothing surfaced that; it was found by hand hours later.
 *
 * An empty list cannot tell those apart, so `getGpuStatus()` distinguishes:
 *   ok        — GPUs found
 *   none      — no NVIDIA GPU on this host (a normal dev laptop)
 *   blocked   — nvidia-smi is present but cannot talk to the driver: a running
 *               container has lost its device access and needs recreating
 *
 * We only read `nvidia-smi` (no GPL code copied); fields that a laptop GPU
 * reports as "[N/A]" (e.g. power on some cards) parse to null.
 */
import { runHostScript } from "@/lib/host-runner";

export type GpuMetric = {
  index: number;
  name: string;
  /** GPU core utilization, %. */
  utilGpu: number;
  /** VRAM used / total, MB. */
  memUsedMb: number;
  memTotalMb: number;
  /** °C — null if the GPU doesn't report it. */
  tempC: number | null;
  /** Watts — null if the GPU doesn't report it (common on laptops). */
  powerW: number | null;
};

/** Parse a numeric nvidia-smi field, treating "[N/A]"/blank as null. */
function num(v: string | undefined): number | null {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

const NVIDIA_SMI = "nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits";

/** In a split frontend/backend Docker deploy the frontend has no GPU and can't
 *  run nvidia-smi, so point this at the backend's GPU sidecar (gpu-server.py),
 *  e.g. http://rantai-backend:8341. Unset → run nvidia-smi locally (dev). */
const GPU_STATS_URL = process.env.GPU_STATS_URL;

/** Get the raw nvidia-smi CSV — from the backend sidecar if configured, else by
 *  running nvidia-smi on the host (local/WSL dev). */
async function fetchGpuCsv(): Promise<string> {
  if (GPU_STATS_URL) {
    const res = await fetch(GPU_STATS_URL, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    // Throw rather than return "": an empty CSV reads as "no GPUs", which is
    // exactly the confusion this module exists to remove.
    if (!res.ok) throw new Error(`gpu sidecar ${res.status}`);
    const data = (await res.json()) as { csv?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.csv ?? "";
  }
  const { stdout } = await runHostScript(NVIDIA_SMI, [], { timeoutMs: 8000 });
  return stdout;
}

/** Why the GPU list is empty, when it is. */
export type GpuHealth = "ok" | "none" | "blocked";

export type GpuStatus = {
  gpus: GpuMetric[];
  health: GpuHealth;
  /** Operator-facing reason, present only when health is not "ok". */
  detail?: string;
};

/** The driver is reachable but refuses us — the container lost device access. */
const BLOCKED = /initialize NVML|Insufficient Permissions|Operation not permitted|couldn't communicate with the NVIDIA driver/i;

/** No NVIDIA hardware or no driver at all — normal on a dev machine. */
const ABSENT = /not found|No such file|command not found|NVIDIA-SMI has failed because.*driver/i;

export async function getGpuStatus(): Promise<GpuStatus> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return { gpus: (await import("@/lib/demo/stores")).demoGpus(), health: "ok" };
  }
  try {
    const gpus = await parseGpus(await fetchGpuCsv());
    if (gpus.length > 0) return { gpus, health: "ok" };
    return {
      gpus: [],
      health: "none",
      detail: "nvidia-smi ran but reported no GPUs on this host.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (BLOCKED.test(message)) {
      return {
        gpus: [],
        health: "blocked",
        detail:
          "The GPU is present but this container cannot reach the driver. Jobs " +
          "that need a GPU will fail until the container is recreated.",
      };
    }
    if (ABSENT.test(message)) {
      return { gpus: [], health: "none", detail: "No NVIDIA GPU is available on this host." };
    }
    return { gpus: [], health: "blocked", detail: `nvidia-smi failed: ${message.slice(0, 200)}` };
  }
}

/** Back-compat: the list alone, for callers that only chart the numbers. */
export async function getGpuMetrics(): Promise<GpuMetric[]> {
  return (await getGpuStatus()).gpus;
}

async function parseGpus(stdout: string): Promise<GpuMetric[]> {
  {
    const gpus: GpuMetric[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [index, name, util, memUsed, memTotal, temp, power] = line
        .split(",")
        .map((s) => s.trim());
      if (!name) continue;
      gpus.push({
        index: num(index) ?? 0,
        name,
        utilGpu: num(util) ?? 0,
        memUsedMb: num(memUsed) ?? 0,
        memTotalMb: num(memTotal) ?? 0,
        tempC: num(temp),
        powerW: num(power),
      });
    }
    return gpus;
  }
}
