/**
 * Server-only helper for the Compute page. Lists Transformer Lab's compute
 * providers (`GET /compute_provider/providers/`) and maps them into the page's
 * ComputeProvider shape. v0.40.0 runs ALL execution through these providers; on
 * a local self-host there's a single built-in "Local" provider.
 */
import { inferenceHeaders } from "@/lib/inference";
import { TL_ROOT } from "@/lib/models-catalog";
import {
  PROVIDER_TYPES,
  type Accelerator,
  type ComputeProvider,
  type ProviderType,
} from "@/modules/compute/types";

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

export async function fetchTlComputeProviders(): Promise<ComputeProvider[]> {
  const res = await fetch(`${TL_ROOT}/compute_provider/providers/`, {
    headers: inferenceHeaders(),
  });
  if (!res.ok) throw new Error(`compute providers ${res.status}`);
  const data = (await res.json().catch(() => [])) as TlProvider[] | { data?: TlProvider[] };
  const rows = Array.isArray(data) ? data : (data.data ?? []);
  return rows
    .filter((p) => p.id)
    .map((p) => {
      const accel = p.config?.supported_accelerators ?? [];
      const accelerators: Accelerator[] = accel
        .filter((a) => a.toLowerCase() !== "cpu")
        .map((a) => ({ name: a, count: 0, vramGb: 0 }));
      return {
        id: p.id as string,
        type: toProviderType(p.type),
        name: p.name ?? "Provider",
        status: p.disabled ? "Disabled" : "Connected",
        isDefault: Boolean(p.is_default),
        detail: accel.length ? `Accelerators: ${accel.join(", ")}` : "",
        accelerators,
        clusters: [],
      } satisfies ComputeProvider;
    });
}
