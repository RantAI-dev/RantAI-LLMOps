"use client";

import { toast } from "sonner";

/**
 * Run an optimistic mutation honestly: apply the local change immediately, fire
 * the request, and — if it fails — roll back and surface an error toast.
 *
 * This replaces the "fire-and-forget `void fetch()` + unconditional local
 * mutation" pattern, which silently lies when the backend rejects (the UI shows
 * a stopped/deleted/saved state that never actually happened server-side).
 *
 * Returns `true` on success, `false` on failure. The usual rollback is just the
 * resource's `reload()` — re-syncing to authoritative server state is simpler
 * and more correct than trying to restore an exact local snapshot.
 */
export async function runOptimistic({
  apply,
  request,
  rollback,
  errorMessage,
}: {
  apply?: () => void;
  request: () => Promise<Response>;
  rollback?: () => void;
  errorMessage?: string;
}): Promise<boolean> {
  apply?.();
  try {
    const res = await request();
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error || `Request gagal (${res.status})`);
    }
    return true;
  } catch (err) {
    rollback?.();
    toast.error(errorMessage ?? (err instanceof Error ? err.message : "Request gagal"));
    return false;
  }
}
