/**
 * Server-side persistence for Deployments (named serve configs). A single JSON
 * file on the app server, so the list is shared across every browser/device/user
 * hitting this app instance — unlike the old per-browser localStorage.
 *
 * Location: `$RANTAI_DATA_DIR/deployments.json` (defaults to `.rantai-data/` in the
 * app working dir; gitignored). Reads degrade to an empty store on any error.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import type { Deployment } from "@/modules/serve/lib/deployment";

export type DeploymentStore = { deployments: Deployment[]; activeId: string | null };

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const FILE = path.join(DATA_DIR, "deployments.json");

const EMPTY: DeploymentStore = { deployments: [], activeId: null };

/** Keep only well-formed deployment records (defends the file against bad writes). */
function sanitize(value: unknown): Deployment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (d): d is Deployment =>
      !!d &&
      typeof d === "object" &&
      typeof (d as Deployment).id === "string" &&
      typeof (d as Deployment).modelId === "string" &&
      typeof (d as Deployment).name === "string"
  );
}

export function normalizeStore(raw: unknown): DeploymentStore {
  const obj = (raw ?? {}) as Partial<DeploymentStore>;
  return {
    deployments: sanitize(obj.deployments),
    activeId: typeof obj.activeId === "string" ? obj.activeId : null,
  };
}

export async function readDeploymentStore(): Promise<DeploymentStore> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (err) {
    // ENOENT = never written yet (legitimately empty). Anything else is a real
    // read failure worth surfacing rather than masking as "no deployments".
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[deployment-store] read failed:", err);
    }
    return EMPTY;
  }
  try {
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    // Corrupt JSON — log it (don't silently reset to empty and let the next write
    // overwrite good-but-unparseable data without anyone noticing).
    console.error("[deployment-store] corrupt store JSON, returning empty:", err);
    return EMPTY;
  }
}

export async function writeDeploymentStore(store: DeploymentStore): Promise<DeploymentStore> {
  const clean = normalizeStore(store);
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Atomic write: write a temp file then rename over the target, so a crash or
  // concurrent write can't leave a half-written / corrupt deployments.json.
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(clean, null, 2), "utf8");
  await fs.rename(tmp, FILE);
  return clean;
}
