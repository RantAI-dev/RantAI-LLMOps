import type { ComputeProvider } from "@/modules/compute/types";

/**
 * The data seam for compute providers — REAL only. The BFF lists Transformer
 * Lab's `/compute_provider/providers/` (a single built-in "Local" provider on a
 * self-host). No mock fallback: an empty/unreachable backend shows empty, not
 * fabricated cloud providers.
 */

/** Sync seed for instant initial render — empty until the real list loads. */
export function seedComputeProviders(): ComputeProvider[] {
  return [];
}

/** Delete a provider in Transformer Lab (via the BFF). */
export async function removeComputeProvider(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/compute/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Async load: real providers from Transformer Lab (via the BFF). */
export async function fetchComputeProviders(): Promise<ComputeProvider[]> {
  try {
    const res = await fetch("/api/compute/providers", { cache: "no-store" });
    const data = (await res.json()) as { providers?: ComputeProvider[] };
    return Array.isArray(data.providers) ? data.providers : [];
  } catch {
    return [];
  }
}
