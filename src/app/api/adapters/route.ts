import { runHostScript } from "@/lib/host-runner";
import { listEngines, resolveEngine } from "@/lib/inference-engines";
import {
  ADAPTER_NAME_RE,
  isSafeAdapterPath,
  loadLoraAdapter,
  unloadLoraAdapter,
} from "@/lib/vllm-lora";
import { addToManifest, readManifest, removeFromManifest } from "@/lib/adapter-manifest-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LoRA adapter management for the vLLM engine.
 *
 * vLLM serves one base model and can hot-load LoRA adapters that the client then
 * routes to per request via the `model` field (base / asklearn / practice …).
 * This route is the UI's control plane for that:
 *   GET  — the base, the adapters currently served, the trained (unmerged)
 *          adapters on disk that could be attached, and the desired-state
 *          manifest (Phase 2): which adapters are `remembered`, and which of
 *          those `drift` (remembered but not currently live — e.g. after a vLLM
 *          restart) so the UI can offer to reconcile.
 *   POST — attach ({action:"load",name,path}) or detach ({action:"unload",name})
 *          an adapter at runtime, proxied to vLLM's dynamic-LoRA API. A
 *          successful attach/detach also updates the manifest so the reconciler
 *          can restore runtime adapters after a restart.
 *
 * Requires the vLLM service to be launched with --enable-lora and
 * VLLM_ALLOW_RUNTIME_LORA_UPDATING=True (see docker-compose.portainer.yml). If it
 * wasn't, vLLM answers the load/unload endpoints with 404 — surfaced as an error.
 */

type Available = { jobId: string; path: string; base: string };

// List trained (unmerged) adapters on disk via the backend host-runner. Best
// effort: if the runner isn't wired for this deployment, the UI just falls back
// to the manual "attach by path" form. Reuses the locator the serve scripts use.
const LIST_CMD =
  `find "$HOME/.transformerlab/orgs" -path '*jobs/*/models/*' -name adapter_config.json 2>/dev/null ` +
  `| while IFS= read -r f; do ` +
  `b=$(sed -n 's/.*"base_model_name_or_path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$f" | head -1); ` +
  `printf '%s|%s\\n' "$b" "$(dirname "$f")"; done`;

async function listAvailable(): Promise<Available[]> {
  try {
    const { stdout } = await runHostScript(LIST_CMD, [], { timeoutMs: 20_000 });
    const seen = new Set<string>();
    const out: Available[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const s = line.trim();
      const bar = s.indexOf("|");
      if (bar < 0) continue;
      const base = s.slice(0, bar);
      const path = s.slice(bar + 1);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const m = /jobs\/([^/]+)\/models\//.exec(path);
      out.push({ jobId: m?.[1] ?? path, path, base });
    }
    return out;
  } catch {
    return [];
  }
}

export async function GET() {
  const vllm = (await listEngines()).find((e) => e.id === "vllm");
  if (!vllm?.configured) {
    return Response.json({
      configured: false,
      reachable: false,
      base: null,
      served: [],
      available: [],
      remembered: [],
      drift: [],
    });
  }
  const ids = vllm.models.map((m) => m.id);
  // Desired-state (Phase 2): which remembered adapters are missing from the live
  // engine. Computed from the models we already fetched — no extra vLLM call.
  const manifest = await readManifest();
  const live = new Set(ids);
  const drift = manifest.filter((a) => !live.has(a.name)).map((a) => a.name);
  return Response.json({
    configured: true,
    reachable: vllm.available,
    base: ids[0] ?? null, // vLLM lists the base first, then each LoRA adapter
    // The REAL model behind the served-name alias (e.g. aisingapore/Gemma-SEA-LION-v4-4B-VL),
    // so the UI can show what's actually loaded + flag base-incompatible adapters.
    baseModel: vllm.baseModel ?? null,
    served: ids.slice(1),
    available: vllm.available ? await listAvailable() : [],
    remembered: manifest.map((a) => a.name),
    drift,
  });
}

export async function POST(req: Request) {
  const engine = resolveEngine("vllm");
  if (!engine.configured) {
    return Response.json({ error: "vLLM isn't configured. Set VLLM_BASE_URL, then redeploy." }, { status: 400 });
  }

  let body: { action?: string; name?: string; path?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!ADAPTER_NAME_RE.test(name)) {
    return Response.json(
      { error: "Adapter name must be 1–64 characters: letters, digits, dot, underscore, or hyphen." },
      { status: 400 }
    );
  }

  if (body.action === "load") {
    const path = (body.path ?? "").trim();
    if (!isSafeAdapterPath(path)) {
      return Response.json(
        { error: "Adapter path must be an absolute path under /root/.transformerlab (the adapter directory)." },
        { status: 400 }
      );
    }
    const res = await loadLoraAdapter(engine, name, path);
    if (!res.ok) return Response.json({ error: res.message }, { status: 502 });
    // Remember it so the reconciler can restore it after a vLLM restart.
    await addToManifest({ name, path });
    return Response.json({ ok: true, message: res.message });
  }

  if (body.action === "unload") {
    const res = await unloadLoraAdapter(engine, name);
    if (!res.ok) return Response.json({ error: res.message }, { status: 502 });
    await removeFromManifest(name);
    return Response.json({ ok: true, message: res.message });
  }

  return Response.json({ error: 'action must be "load" or "unload".' }, { status: 400 });
}
