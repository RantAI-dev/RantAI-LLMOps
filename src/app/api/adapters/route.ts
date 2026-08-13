import { runHostScript } from "@/lib/host-runner";
import { listEngines, resolveEngine } from "@/lib/inference-engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LoRA adapter management for the vLLM engine.
 *
 * vLLM serves one base model and can hot-load LoRA adapters that the client then
 * routes to per request via the `model` field (base / asklearn / practice …).
 * This route is the UI's control plane for that:
 *   GET  — the base, the adapters currently served, and the trained (unmerged)
 *          adapters on disk that could be attached.
 *   POST — attach ({action:"load",name,path}) or detach ({action:"unload",name})
 *          an adapter at runtime, proxied to vLLM's dynamic-LoRA API.
 *
 * Requires the vLLM service to be launched with --enable-lora and
 * VLLM_ALLOW_RUNTIME_LORA_UPDATING=True (see docker-compose.portainer.yml). If it
 * wasn't, vLLM answers the load/unload endpoints with 404 — surfaced as an error.
 */

// vLLM's dynamic-LoRA endpoints live under the same /v1 base as chat/models.
const LOAD_PATH = "/load_lora_adapter";
const UNLOAD_PATH = "/unload_lora_adapter";

// Adapter name = the `model` a client routes by. Keep it id/URL-safe.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The adapter dir must be one vLLM can read: under the mounted TL data, no traversal. */
function isSafeAdapterPath(p: string): boolean {
  return p.startsWith("/root/.transformerlab/") && !p.includes("..") && !/[\s;&|`$()<>]/.test(p);
}

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
    return Response.json({ configured: false, reachable: false, base: null, served: [], available: [] });
  }
  const ids = vllm.models.map((m) => m.id);
  return Response.json({
    configured: true,
    reachable: vllm.available,
    base: ids[0] ?? null, // vLLM lists the base first, then each LoRA adapter
    served: ids.slice(1),
    available: vllm.available ? await listAvailable() : [],
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
  if (!NAME_RE.test(name)) {
    return Response.json(
      { error: "Adapter name must be 1–64 characters: letters, digits, dot, underscore, or hyphen." },
      { status: 400 }
    );
  }

  let url: string;
  let payload: Record<string, string>;
  if (body.action === "load") {
    const path = (body.path ?? "").trim();
    if (!isSafeAdapterPath(path)) {
      return Response.json(
        { error: "Adapter path must be an absolute path under /root/.transformerlab (the adapter directory)." },
        { status: 400 }
      );
    }
    url = `${engine.v1BaseUrl}${LOAD_PATH}`;
    payload = { lora_name: name, lora_path: path };
  } else if (body.action === "unload") {
    url = `${engine.v1BaseUrl}${UNLOAD_PATH}`;
    payload = { lora_name: name };
  } else {
    return Response.json({ error: 'action must be "load" or "unload".' }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: engine.headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    // vLLM answers these with a plain-text message, not JSON.
    const text = (await res.text()).trim();
    if (!res.ok) {
      const hint =
        res.status === 404
          ? " (vLLM must run with VLLM_ALLOW_RUNTIME_LORA_UPDATING=True to allow runtime changes)"
          : "";
      return Response.json({ error: `${text || `vLLM returned ${res.status}`}${hint}` }, { status: 502 });
    }
    return Response.json({ ok: true, message: text || `${body.action} ok` });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Request to vLLM failed.";
    return Response.json({ error: `Could not reach vLLM: ${detail}` }, { status: 502 });
  }
}
