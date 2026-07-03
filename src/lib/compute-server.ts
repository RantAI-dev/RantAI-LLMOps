/**
 * Server-only helper for the Compute page. Lists Transformer Lab's compute
 * providers (`GET /compute_provider/providers/`) and maps them into the page's
 * ComputeProvider shape. v0.40.0 runs ALL execution through these providers; on
 * a local self-host there's a single built-in "Local" provider.
 */
import { runHostScript } from "@/lib/host-runner";
import { tlFetch, unwrapList } from "@/lib/tl-fetch";
import {
  PROVIDER_TYPES,
  type Accelerator,
  type ComputeProvider,
  type ProviderType,
} from "@/modules/compute/types";

/**
 * Real GPUs on the backend host via `nvidia-smi` (TL's provider list only knows
 * the accelerator *type*, not the model/VRAM/count). Best-effort: returns [] if
 * nvidia-smi is unavailable, so the caller falls back to the TL-reported type.
 */
async function detectGpus(): Promise<Accelerator[]> {
  try {
    const { stdout } = await runHostScript(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
      [],
      { timeoutMs: 8000 }
    );
    const byModel = new Map<string, { count: number; vramGb: number }>();
    for (const line of stdout.split("\n")) {
      const [name, mem] = line.split(",").map((s) => s.trim());
      if (!name) continue;
      const vramGb = Math.round((Number(mem) || 0) / 1024);
      const cur = byModel.get(name) ?? { count: 0, vramGb };
      byModel.set(name, { count: cur.count + 1, vramGb });
    }
    return [...byModel].map(([name, v]) => ({ name, count: v.count, vramGb: v.vramGb }));
  } catch {
    return [];
  }
}

type TlProvider = {
  id?: string;
  name?: string;
  type?: string;
  disabled?: boolean;
  is_default?: boolean;
  config?: { supported_accelerators?: string[] };
};

function toProviderType(t?: string): ProviderType {
  const match = PROVIDER_TYPES.find((p) => p.toLowerCase() === String(t ?? "").toLowerCase());
  return match ?? "Local";
}

/** Create a compute provider (`POST /compute_provider/providers/`). */
export async function createTlComputeProvider(name: string, type: string): Promise<boolean> {
  try {
    // UI labels ("SkyPilot", "Vast.ai") → backend enum ("skypilot", "vastai").
    const beType = type.toLowerCase().replace(/[^a-z0-9]/g, "");
    const res = await tlFetch(`/compute_provider/providers/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: beType, config: {} }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete a compute provider (`DELETE /compute_provider/providers/{id}`). */
export async function deleteTlComputeProvider(id: string): Promise<boolean> {
  try {
    const res = await tlFetch(`/compute_provider/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchTlComputeProviders(): Promise<ComputeProvider[]> {
  const res = await tlFetch(`/compute_provider/providers/`);
  if (!res.ok) throw new Error(`compute providers ${res.status}`);
  const rows = unwrapList<TlProvider>(await res.json().catch(() => [])).filter((p) => p.id);

  // A local provider runs on this host, so enrich it with the real GPUs. (Remote
  // providers' hardware lives elsewhere — don't attribute local GPUs to them.)
  const hasLocal = rows.some((p) => toProviderType(p.type) === "Local");
  const localGpus = hasLocal ? await detectGpus() : [];

  return rows.map((p) => {
    const type = toProviderType(p.type);
    const supported = (p.config?.supported_accelerators ?? []).filter(
      (a) => a.toLowerCase() !== "cpu"
    );
    // Real detected GPUs for local; else the type list TL reports (no count/VRAM).
    const accelerators: Accelerator[] =
      type === "Local" && localGpus.length > 0
        ? localGpus
        : supported.map((a) => ({ name: a, count: 0, vramGb: 0 }));
    return {
      id: p.id as string,
      type,
      name: p.name ?? "Provider",
      status: p.disabled ? "Disabled" : "Connected",
      isDefault: Boolean(p.is_default),
      detail:
        type === "Local"
          ? "Runs jobs directly on this host (no remote cluster)."
          : supported.length
            ? `Accelerators: ${supported.join(", ")}`
            : "",
      accelerators,
      clusters: [],
    } satisfies ComputeProvider;
  });
}
