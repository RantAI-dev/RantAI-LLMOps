/**
 * Adapter merges, tracked as jobs instead of held inside a request.
 *
 * Evaluating a fine-tune means merging its LoRA adapter into the base first —
 * the harness cannot load an adapter from HF. For a 4B model that merge writes
 * **8.1 GB** on CPU and takes well over twenty minutes.
 *
 * That collided with a nine-minute timeout in host-runner, so the FIRST eval of
 * any fresh 4B adapter always failed: the sidecar call was aborted, the UI
 * reported an error, and the merge carried on to completion in the background
 * regardless. A second attempt then "worked" — not because anything was fixed,
 * but because `rantai_merge.sh` skips a merge whose output already exists. The
 * user was being asked to submit twice and told the first one failed.
 *
 * The merge itself was never the problem; waiting for it inside a call that had
 * a deadline was. So it moves here: `startMerge` returns a handle immediately,
 * the merge runs with a timeout matched to the work (90 min), and callers poll.
 *
 * State is in-process and deliberately so. It describes work owned by THIS
 * process; a restart loses the handle but never the merge's output, and the
 * script's own existence check means a resubmit after a restart costs nothing.
 */
import { logServerError } from "@/lib/log";

/** How long a merge may run before we call it stuck. */
const MERGE_TIMEOUT_MS = 90 * 60_000;

/** How long a finished record is kept so the UI can read its outcome. */
const RETAIN_MS = 30 * 60_000;

export type MergeStatus = "RUNNING" | "COMPLETE" | "FAILED";

export type MergeJob = {
  /** The train job whose adapter is being merged. Also the map key. */
  jobId: string;
  status: MergeStatus;
  /** Merged model dir on the host — set once COMPLETE. */
  modelPath?: string;
  /** The fine-tune's name, carried through for the eval's label. */
  label: string;
  /** Why it failed, in one line — set once FAILED. */
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

type Entry = MergeJob & { promise: Promise<MergeJob> };

const merges = new Map<string, Entry>();

/** Drop finished records once nothing is likely to read them again. */
function sweep(): void {
  const now = Date.now();
  for (const [id, m] of merges) {
    if (m.status !== "RUNNING" && m.finishedAt && now - m.finishedAt > RETAIN_MS) {
      merges.delete(id);
    }
  }
}

/**
 * The merge a `runMerge` implementation performs. Injected rather than imported
 * so this module stays free of the eval-specific lookups (and testable).
 */
export type RunMerge = (jobId: string) => Promise<{ modelPath: string; label: string }>;

/**
 * Begin merging an adapter, or join the merge already running for it.
 *
 * Returns at once. Two evals submitted for the same fine-tune share one merge:
 * without that they would race on the same output directory, each writing 8 GB
 * over the other's half-written files.
 */
export function startMerge(jobId: string, label: string, run: RunMerge): MergeJob {
  sweep();

  const existing = merges.get(jobId);
  // A finished merge is re-run only if it FAILED — a COMPLETE one still has its
  // output on disk, which is the whole reason a retry used to appear to work.
  if (existing && (existing.status === "RUNNING" || existing.status === "COMPLETE")) {
    return snapshot(existing);
  }

  const entry: Entry = {
    jobId,
    label,
    status: "RUNNING",
    startedAt: Date.now(),
    promise: Promise.resolve() as unknown as Promise<MergeJob>,
  };

  entry.promise = (async () => {
    try {
      const { modelPath, label: name } = await run(jobId);
      entry.status = "COMPLETE";
      entry.modelPath = modelPath;
      entry.label = name || label;
    } catch (err) {
      entry.status = "FAILED";
      entry.error = err instanceof Error ? err.message : String(err);
      logServerError("merge-jobs", err);
    } finally {
      entry.finishedAt = Date.now();
    }
    return snapshot(entry);
  })();

  merges.set(jobId, entry);
  return snapshot(entry);
}

/** Current state of a merge, or undefined if this process never started one. */
export function getMerge(jobId: string): MergeJob | undefined {
  sweep();
  const e = merges.get(jobId);
  return e ? snapshot(e) : undefined;
}

/** Every merge this process knows about, newest first. */
export function listMerges(): MergeJob[] {
  sweep();
  return [...merges.values()].map(snapshot).sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Wait for a merge to finish. Used by the synchronous submit path (Compare),
 * which needs the job id back and so cannot return before the merge lands.
 */
export async function awaitMerge(jobId: string): Promise<MergeJob | undefined> {
  const e = merges.get(jobId);
  if (!e) return undefined;
  return e.promise;
}

/** The timeout a merge should be given — exported so callers stay consistent. */
export const mergeTimeoutMs = MERGE_TIMEOUT_MS;

/** A plain copy without the promise, safe to serialise to the client. */
function snapshot(e: Entry | MergeJob): MergeJob {
  const { jobId, status, modelPath, label, error, startedAt, finishedAt } = e;
  return { jobId, status, modelPath, label, error, startedAt, finishedAt };
}

/** Test seam: forget all tracked merges. */
export function __resetMerges(): void {
  merges.clear();
}
