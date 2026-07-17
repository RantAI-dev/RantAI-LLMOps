import {
  maskKey,
  newApiKey,
  readGatewayStore,
  writeGatewayStore,
  type ApiKey,
} from "@/lib/gateway-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tier-2 gateway control: which models are exposed to external clients + the API
 * keys that may call them. Edited by the Deployments page; enforced live by the
 * gateway (docker/backend/gateway.py) via the shared config file that
 * writeGatewayStore() produces.
 *
 * GET  -> { deployedModels, apiKeys: [{id,name,keyMasked,createdAt}] } (never the raw key)
 * POST -> { action: "setModels" | "createKey" | "revokeKey", ... }
 *         createKey returns the full key ONCE (`created.key`), then it's masked forever.
 */
function publicKey(k: ApiKey) {
  return { id: k.id, name: k.name, keyMasked: maskKey(k.key), createdAt: k.createdAt };
}

export async function GET() {
  const store = await readGatewayStore();
  return Response.json({
    deployedModels: store.deployedModels,
    apiKeys: store.apiKeys.map(publicKey),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const store = await readGatewayStore();

  if (action === "setModels") {
    const models = Array.isArray(body.models) ? body.models.filter((m: unknown) => typeof m === "string") : [];
    const saved = await writeGatewayStore({ ...store, deployedModels: models });
    return Response.json({ deployedModels: saved.deployedModels });
  }

  if (action === "createKey") {
    const key = newApiKey(typeof body.name === "string" ? body.name : "key");
    await writeGatewayStore({ ...store, apiKeys: [...store.apiKeys, key] });
    // Only time the raw key is ever returned.
    return Response.json({ created: { id: key.id, name: key.name, key: key.key, createdAt: key.createdAt } });
  }

  if (action === "revokeKey") {
    const id = String(body.id ?? "");
    const saved = await writeGatewayStore({ ...store, apiKeys: store.apiKeys.filter((k) => k.id !== id) });
    return Response.json({ apiKeys: saved.apiKeys.map(publicKey) });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
