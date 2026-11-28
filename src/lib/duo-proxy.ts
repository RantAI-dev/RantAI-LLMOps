/**
 * Server-only pass-through from the Semantic Duo pages to the Rantai-Aql gateway (`/api/duo/gw/<gateway path>`).
 *
 * The browser never sees the gateway's address or token: this module adds the bearer token and forwards only the
 * gateway routes listed in DUO_ROUTES (method + path pattern). Bodies are streamed both ways, so document uploads
 * (multipart), the chat stream (SSE) and file downloads (export) pass through unchanged.
 */

import { duoConfigured } from "@/lib/duo";

const baseUrl = () => (process.env.DUO_GATEWAY_URL ?? "").trim().replace(/\/+$/, "");
const token = () => (process.env.DUO_GATEWAY_TOKEN ?? "").trim();

export type DuoMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// One path segment: an id or a name (knowledge-base names, run ids, uuids). No slashes, no dot segments.
const SEG = "[^/]+";
const route = (method: DuoMethod, path: string) => ({
  method,
  re: new RegExp(`^${path.replace(/\{[a-z_]+\}/g, SEG)}$`),
});

/**
 * The gateway routes the Semantic Duo pages use. Anything else is refused (404) before it reaches the gateway, so a
 * new gateway endpoint is only reachable once it is listed here. Not listed on purpose: /metrics (Prometheus, for the
 * monitoring stack), /ws/rooms (a WebSocket, which a route handler cannot upgrade).
 */
export const DUO_ROUTES = [
  // chat
  route("POST", "/v1/chat"),
  route("POST", "/v1/chat/stream"),
  route("GET", "/v1/conversations"),
  route("GET", "/v1/conversations/{id}"),
  route("PATCH", "/v1/conversations/{id}"),
  route("DELETE", "/v1/conversations/{id}"),
  route("GET", "/v1/decisions/{id}"),
  route("POST", "/v1/replies/{id}/feedback"),
  route("POST", "/v1/sessions/{id}/commit"),
  route("POST", "/v1/parse"),
  route("POST", "/v1/export"),
  route("GET", "/v1/export/formats"),
  // rooms (list and manage; live rooms need the WebSocket)
  route("GET", "/v1/rooms"),
  route("POST", "/v1/rooms"),
  route("GET", "/v1/rooms/{id}"),
  route("PATCH", "/v1/rooms/{id}"),
  route("DELETE", "/v1/rooms/{id}"),
  // knowledge
  route("GET", "/v1/kb/status"),
  route("GET", "/v1/kb"),
  route("POST", "/v1/kb"),
  route("GET", "/v1/kb/{kb}"),
  route("PATCH", "/v1/kb/{kb}"),
  route("DELETE", "/v1/kb/{kb}"),
  route("GET", "/v1/kb/{kb}/documents"),
  route("POST", "/v1/kb/{kb}/documents"),
  route("GET", "/v1/kb/{kb}/documents/{doc}"),
  route("DELETE", "/v1/kb/{kb}/documents/{doc}"),
  route("POST", "/v1/kb/{kb}/documents/{doc}/reingest"),
  route("GET", "/v1/kb/{kb}/documents/{doc}/chunks"),
  route("POST", "/v1/kb/{kb}/reindex"),
  route("POST", "/v1/kb/{kb}/search"),
  route("GET", "/v1/kb/{kb}/graph"),
  route("POST", "/v1/kb/{kb}/graph/build"),
  route("GET", "/v1/kb/{kb}/graph/entities"),
  route("GET", "/v1/kb/{kb}/graph/entities/{entity}"),
  route("GET", "/v1/kb/{kb}/ontology"),
  route("PUT", "/v1/kb/{kb}/ontology"),
  route("GET", "/v1/kb/{kb}/memory/runs"),
  route("POST", "/v1/kb/{kb}/memory/runs"),
  route("POST", "/v1/kb/{kb}/memory/runs/{run}/stop"),
  route("POST", "/v1/kb/{kb}/memory/runs/{run}/activate"),
  route("POST", "/v1/compile"),
  // memory and files (context filesystem)
  route("GET", "/v1/memory"),
  route("POST", "/v1/memory"),
  route("DELETE", "/v1/memory"),
  route("POST", "/v1/memory/tidy"),
  route("DELETE", "/v1/memory/{id}"),
  route("GET", "/v1/memory/diff"),
  route("POST", "/v1/memory/diff/{id}/undo"),
  route("GET", "/v1/fs/ls"),
  route("GET", "/v1/fs/tree"),
  route("GET", "/v1/fs/read"),
  route("GET", "/v1/fs/stat"),
  route("GET", "/v1/fs/glob"),
  route("POST", "/v1/fs/grep"),
  route("POST", "/v1/fs/find"),
  route("POST", "/v1/fs/search"),
  route("PUT", "/v1/fs/write"),
  route("DELETE", "/v1/fs/rm"),
  // code agent
  route("GET", "/v1/harness"),
  route("POST", "/v1/harness/runs"),
  route("GET", "/v1/harness/runs"),
  route("GET", "/v1/harness/runs/{id}"),
  route("POST", "/v1/harness/runs/{id}/stop"),
  // quality: gate, verifiers, judge, audits, drift, alerts
  route("GET", "/v1/gate"),
  route("POST", "/v1/gate"),
  route("GET", "/v1/gate/labels"),
  route("POST", "/v1/gate/recalibrate"),
  route("POST", "/v1/gate/derive"),
  route("GET", "/v1/gate/params"),
  route("DELETE", "/v1/gate/params"),
  route("GET", "/v1/gates"),
  route("GET", "/v1/self-model"),
  route("GET", "/v1/drift"),
  route("GET", "/v1/alerts"),
  route("POST", "/v1/alerts/drill"),
  route("GET", "/v1/audits"),
  route("POST", "/v1/audits/run-next"),
  route("POST", "/v1/verify"),
  route("POST", "/v1/judge"),
  route("GET", "/v1/verifiers"),
  route("GET", "/v1/verifiers/runs"),
  route("POST", "/v1/verifiers/runs"),
  route("GET", "/v1/verifiers/runs/{id}"),
  route("POST", "/v1/verifiers/runs/{id}/cancel"),
  route("GET", "/v1/preferences"),
  route("POST", "/v1/preferences"),
  // learning (Tazkiya)
  route("GET", "/v1/tazkiya"),
  route("GET", "/v1/tazkiya/review"),
  route("POST", "/v1/tazkiya/review/{id}"),
  // experiments
  route("GET", "/v1/eval/datasets"),
  route("GET", "/v1/eval/datasets/{name}"),
  route("GET", "/v1/eval/runs"),
  route("POST", "/v1/eval/runs"),
  route("GET", "/v1/eval/runs/{id}"),
  route("POST", "/v1/eval/runs/{id}/cancel"),
  route("POST", "/v1/eval/runs/{id}/resume"),
  route("POST", "/v1/eval/runs/{id}/calibrate"),
  route("GET", "/v1/eval/runs/{id}/export"),
  route("GET", "/v1/lab/insights"),
  // reasoning cache
  route("GET", "/v1/arc"),
  route("POST", "/v1/arc/build"),
  route("POST", "/v1/arc/try"),
  route("POST", "/v1/arc/compile"),
  route("GET", "/v1/arc/{id}"),
  route("DELETE", "/v1/arc/{id}"),
  route("POST", "/v1/arc/{id}/status"),
  // speed
  route("GET", "/v1/bench/prompt-sets"),
  route("GET", "/v1/bench/runs"),
  route("POST", "/v1/bench/runs"),
  route("GET", "/v1/bench/runs/{id}"),
  route("POST", "/v1/bench/runs/{id}/cancel"),
  route("POST", "/v1/bench/protocol"),
  route("GET", "/v1/perf/stages"),
  // status
  route("GET", "/healthz"),
  route("GET", "/v1/system"),
  route("GET", "/v1/system/activity"),
  route("POST", "/v1/system/backend"),
];

/**
 * The gateway path for the catch-all segments, or null when it is not an allowed route. Segments arrive decoded;
 * each is re-encoded, and dot segments or empty segments are refused so a crafted path cannot climb out.
 */
export function duoTarget(method: string, segments: string[]): string | null {
  if (!segments.length || segments.some((s) => !s || s === "." || s === ".." || s.includes("/") || s.includes("\\"))) return null;
  const path = "/" + segments.map((s) => encodeURIComponent(s)).join("/");
  const m = method.toUpperCase();
  return DUO_ROUTES.some((r) => r.method === m && r.re.test(path)) ? path : null;
}

// Request headers forwarded to the gateway; everything else (cookies, the LLMOps session) stays here.
const FORWARD_REQUEST = ["content-type", "accept", "last-event-id"];
// Response headers passed back to the browser.
const FORWARD_RESPONSE = ["content-type", "content-disposition", "cache-control", "retry-after", "x-request-id"];

/** Upload limit for one proxied request body (the gateway's own max_request_mb is 200). */
export const DUO_MAX_BODY_BYTES = 210 * 1024 * 1024;

/** Forward one browser request to the gateway and stream the answer back. */
export async function duoProxy(req: Request, segments: string[]): Promise<Response> {
  if (!duoConfigured()) return Response.json({ error: "Semantic Duo is not configured (DUO_GATEWAY_URL)" }, { status: 503 });
  const path = duoTarget(req.method, segments);
  if (!path) return Response.json({ error: "Not an available Semantic Duo route" }, { status: 404 });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > DUO_MAX_BODY_BYTES) return Response.json({ error: "The upload is too large (at most 200 MB per request)" }, { status: 413 });

  const search = new URL(req.url).search;
  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (token()) headers.set("authorization", `Bearer ${token()}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}${search}`, {
      method: req.method,
      headers,
      ...(hasBody ? { body: req.body, duplex: "half" } : {}),
      // The browser closing the page ends the gateway call too (a long System 2 answer, a stream).
      signal: req.signal,
      cache: "no-store",
    } as RequestInit);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return Response.json(
      { error: `The Semantic Duo gateway is unreachable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
  // 401 from the gateway means OUR token is wrong: a server problem, not the user's. A 403 has other causes too (a
  // Host not in NAFS_ALLOWED_HOSTS, a cross-origin check), so its own message is passed on.
  if (res.status === 401 || res.status === 403) {
    let detail = "";
    try {
      const j = JSON.parse(await res.text()) as { message?: string; error?: string };
      detail = j.message ?? j.error ?? "";
    } catch {
      /* not JSON */
    }
    const error =
      res.status === 401
        ? "The Semantic Duo gateway refused this server's token (DUO_GATEWAY_TOKEN)"
        : `The Semantic Duo gateway refused the request${detail ? `: ${detail}` : ""} (check DUO_GATEWAY_TOKEN and the gateway's NAFS_ALLOWED_HOSTS)`;
    return Response.json({ error }, { status: 502 });
  }
  const out = new Headers();
  for (const h of FORWARD_RESPONSE) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  if ((out.get("content-type") ?? "").includes("text/event-stream")) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
