import { initialProviders } from "@/modules/compute/data/initial-compute";
import type { ComputeProvider } from "@/modules/compute/types";

/**
 * The data seam for compute providers. Real now: the BFF lists Transformer Lab's
 * `/compute_provider/providers/`. Seed mock is the instant first paint.
 */

/** Sync seed for instant initial render while the real list loads. */
export function seedComputeProviders(): ComputeProvider[] {
  return initialProviders;
}

/** Create a provider in Transformer Lab (via the BFF). */
export async function addComputeProvider(input: { name: string; type: string }): Promise<boolean> {
  try {
    const res = await fetch("/api/compute/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch {
    return false;
  }
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
    if (Array.isArray(data.providers)) return data.providers;
    return initialProviders;
  } catch {
    // BFF unreachable (e.g. SSR/tests) — fall back to the seed for a useful page.
    return initialProviders;
  }
}
