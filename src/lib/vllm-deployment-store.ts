/**
 * Persisted record of the CURRENT vLLM serving deployment launched from the UI
 * (via TL's compute provider — see src/lib/serve-vllm.ts). One deployment at a
 * time for the MVP. Stored server-side as a JSON file under `$RANTAI_DATA_DIR`,
 * consistent with the gateway / workflow-run stores.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");

export type VllmAdapter = { name: string; path: string };

export type VllmDeployment = {
  /** How it was launched: "provider" (TL venv, portable) or "container"
   *  (a Docker container — the GB10 path). Older records omit it → "provider". */
  launcher?: "provider" | "container";
  /** provider launcher: the TL job id. container launcher: unused. */
  jobId: string;
  /** container launcher: the managed container name. */
  containerName?: string;
  baseModel: string;
  servedName: string;
  port: number;
  gpuUtil: string;
  maxModelLen: string;
  /** "" = no quantization. */
  quant: string;
  adapters: VllmAdapter[];
  deployedAt: number;
  /** Multimodal limits the engine was started with (vision bases only); absent = engine defaults. */
  limitMmImages?: number;
  maxImagePixels?: number;
};

/** A one-deployment JSON store per engine (vLLM and SGLang keep separate files). */
export function createDeploymentStore(fileName: string, tag: string) {
  const file = path.join(DATA_DIR, fileName);
  return {
    async read(): Promise<VllmDeployment | null> {
      try {
        const raw = await fs.readFile(file, "utf8");
        const d = JSON.parse(raw) as VllmDeployment;
        return d && typeof d.jobId === "string" ? d : null;
      } catch {
        return null;
      }
    },
    async write(d: VllmDeployment): Promise<void> {
      try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(file, JSON.stringify(d, null, 2), "utf8");
      } catch (err) {
        console.error(`[${tag}] write failed:`, err);
        throw err;
      }
    },
    async clear(): Promise<void> {
      try {
        await fs.rm(file, { force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

const vllmStore = createDeploymentStore("vllm-deployment.json", "vllm-deployment");
export const readVllmDeployment = vllmStore.read;
export const writeVllmDeployment = vllmStore.write;
export const clearVllmDeployment = vllmStore.clear;
