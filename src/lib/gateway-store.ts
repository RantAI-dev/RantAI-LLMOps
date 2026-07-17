/**
 * Server-side state for the LLM gateway (Tier 2): which models are exposed to
 * external clients + the API keys that may call them. The Deployments UI edits
 * this; the gateway (docker/backend/gateway.py) enforces it.
 *
 * Two files are written on every change:
 *  - `$RANTAI_DATA_DIR/gateway.json` — the full record (source of truth, keeps
 *    key names + timestamps for the UI).
 *  - `$GATEWAY_CONFIG_PATH` (a shared volume the gateway also mounts) — the
 *    minimal `{ keys, models }` the gateway re-reads on EVERY request, so a toggle
 *    or a revoked key takes effect live with no restart.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ApiKey = { id: string; name: string; key: string; createdAt: number };
export type GatewayStore = { deployedModels: string[]; apiKeys: ApiKey[] };

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const FILE = path.join(DATA_DIR, "gateway.json");
/** The file the gateway container reads (GATEWAY_CONFIG_FILE on its side). Unset
 *  in local dev → we simply skip writing it. */
const GATEWAY_CONFIG_PATH = process.env.GATEWAY_CONFIG_PATH ?? "";

const EMPTY: GatewayStore = { deployedModels: [], apiKeys: [] };

function normalize(raw: unknown): GatewayStore {
  const obj = (raw ?? {}) as Partial<GatewayStore>;
  const models = Array.isArray(obj.deployedModels)
    ? obj.deployedModels.filter((m): m is string => typeof m === "string")
    : [];
  const keys = Array.isArray(obj.apiKeys)
    ? obj.apiKeys.filter(
        (k): k is ApiKey =>
          !!k && typeof k === "object" && typeof (k as ApiKey).id === "string" && typeof (k as ApiKey).key === "string"
      )
    : [];
  return { deployedModels: [...new Set(models)], apiKeys: keys };
}

export async function readGatewayStore(): Promise<GatewayStore> {
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[gateway-store] read failed:", err);
    }
    return EMPTY;
  }
}

async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

export async function writeGatewayStore(store: GatewayStore): Promise<GatewayStore> {
  const clean = normalize(store);
  await atomicWrite(FILE, JSON.stringify(clean, null, 2));
  // Push the minimal live config to the gateway's shared file (best-effort: a
  // failure here must not lose the UI edit already saved above).
  if (GATEWAY_CONFIG_PATH) {
    try {
      await atomicWrite(
        GATEWAY_CONFIG_PATH,
        JSON.stringify({ keys: clean.apiKeys.map((k) => k.key), models: clean.deployedModels })
      );
    } catch (err) {
      console.error("[gateway-store] failed to write gateway config file:", err);
    }
  }
  return clean;
}

/** Generate a new opaque API key (shown to the user once). */
export function newApiKey(name: string): ApiKey {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "key",
    key: `gw-${crypto.randomBytes(24).toString("hex")}`,
    createdAt: Date.now(),
  };
}

/** Mask a key for display: keep the `gw-` prefix + last 4 chars. */
export function maskKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 5)}…${key.slice(-4)}` : "•••••";
}
