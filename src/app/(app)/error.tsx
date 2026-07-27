"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Segment error boundary for the authenticated app group. Catches render/data
 * errors within (app)/* while keeping the root layout mounted, so the user
 * stays inside the shell and can retry without a full reload.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-surface px-6 py-24 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="max-w-md text-sm text-ink-soft">
          This section failed to load. You can try again — if the problem
          persists, reload the page.
        </p>
        {error?.digest ? (
          <p className="pt-1 font-mono text-xs text-ink-faint">Error ID: {error.digest}</p>
        ) : null}
      </div>
      <Button type="button" onClick={() => reset()} className="mt-1">
        <RotateCcw className="size-4" /> Try again
      </Button>
    </div>
  );
}
