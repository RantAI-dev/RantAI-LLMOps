/**
 * Persisted record of the CURRENT vLLM serving deployment launched from the UI
 * (via TL's compute provider — see src/lib/serve-vllm.ts). One deployment at a
 * time for the MVP. Stored server-side as a JSON file under `$RANTAI_DATA_DIR`,
 * consistent with the gateway / workflow-run stores.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const FILE = path.join(DATA_DIR, "vllm-deployment.json");

export type VllmAdapter = { name: string; path: string };

export type VllmDeployment = {
  /** TL job id of the running serve task. */
  jobId: string;
  baseModel: string;
  servedName: string;
  port: number;
  gpuUtil: string;
  maxModelLen: string;
  /** "" = no quantization. */
  quant: string;
  adapters: VllmAdapter[];
  deployedAt: number;
};

export async function readVllmDeployment(): Promise<VllmDeployment | null> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const d = JSON.parse(raw) as VllmDeployment;
    return d && typeof d.jobId === "string" ? d : null;
  } catch {
    return null;
  }
}

export async function writeVllmDeployment(d: VllmDeployment): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(d, null, 2), "utf8");
  } catch (err) {
    console.error("[vllm-deployment] write failed:", err);
    throw err;
  }
}

export async function clearVllmDeployment(): Promise<void> {
  try {
    await fs.rm(FILE, { force: true });
  } catch {
    /* ignore */
  }
}
