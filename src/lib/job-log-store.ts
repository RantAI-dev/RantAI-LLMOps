/**
 * Server-side snapshot of a job's raw training log (provider console + SDK
 * output). Transformer Lab PURGES `provider_logs` shortly after a job ends, so
 * the live training monitor (loss curve + log) would go blank for finished runs.
 * We snapshot the log to disk while it's still available, then serve the snapshot
 * once TL has purged it — so a completed run's loss curve + log survive.
 *
 * One plain-text file per job under `$RANTAI_DATA_DIR/job-logs/<jobId>.log`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const LOG_DIR = path.join(DATA_DIR, "job-logs");

function fileFor(jobId: string): string {
  // TL ids are uuids/numbers; sanitize hard so a job id can never escape LOG_DIR.
  const safe = jobId.replace(/[^a-zA-Z0-9._-]/g, "_") || "job";
  return path.join(LOG_DIR, `${safe}.log`);
}

/**
 * Snapshot a job's log. The caller only saves while the live provider console is
 * present (a running job), always with the freshest tail — so a plain atomic
 * overwrite is correct; the last snapshot before TL purges is what survives.
 */
export async function saveJobLog(jobId: string, text: string): Promise<void> {
  if (!text.trim()) return;
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const file = fileFor(jobId);
    // Atomic write: temp file then rename, so a crash can't leave a half-written log.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, file);
  } catch (err) {
    console.error("[job-log-store] save failed:", err);
  }
}

/** The persisted log for a job (empty string if none was captured). */
export async function readJobLog(jobId: string): Promise<string> {
  try {
    return await fs.readFile(fileFor(jobId), "utf8");
  } catch {
    return "";
  }
}
