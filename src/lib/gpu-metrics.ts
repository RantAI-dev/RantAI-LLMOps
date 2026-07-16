/**
 * Realtime GPU telemetry via `nvidia-smi` on the backend host — the live
 * complement to compute-server's one-off inventory. Powers the Compute page +
 * training monitor so a user can watch GPU utilization / VRAM / temp / power
 * while a job runs. Best-effort: returns [] when nvidia-smi is unavailable.
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
    if (!res.ok) return "";
    const data = (await res.json()) as { csv?: string };
    return data.csv ?? "";
  }
  const { stdout } = await runHostScript(NVIDIA_SMI, [], { timeoutMs: 8000 });
  return stdout;
}

export async function getGpuMetrics(): Promise<GpuMetric[]> {
  try {
    const stdout = await fetchGpuCsv();
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
  } catch {
    return [];
  }
}
