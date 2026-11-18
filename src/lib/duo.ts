/**
 * Server-only client for a Rantai-Aql gateway (RantAI-dev/Rantai-Aql, the RantAI fork of Nafs-Aql): System 1 drafts,
 * a gate decides whether System 2 (a reasoning model) should take over, and a checker or judge labels the answer.
 * See docs/RENCANA-DUO.md.
 *
 * Config (frontend env; both stay on the server, the browser never sees the token):
 *   DUO_GATEWAY_URL     e.g. http://rantai-aql:8080. Empty = the Duo page says it is not configured.
 *   DUO_GATEWAY_TOKEN   one of the gateway's bearer tokens (NAFS_AUTH_TOKENS on the gateway).
 */

const baseUrl = () => (process.env.DUO_GATEWAY_URL ?? "").trim().replace(/\/+$/, "");
const token = () => (process.env.DUO_GATEWAY_TOKEN ?? "").trim();

export const duoConfigured = () => baseUrl() !== "";

/** The gateway's own limits (ChatRequest in its OpenAPI): at most 400 messages, 8,000 characters per message. */
export const DUO_MAX_MESSAGES = 400;
export const DUO_MAX_CHARS = 8000;

export type DuoMode = "auto" | "fast" | "slow";
export type DuoMessage = { role: "user" | "assistant"; content: string };
export type DuoRequest = { messages: DuoMessage[]; mode: DuoMode; lambda?: number };

/** An error carrying the HTTP status to answer with. */
export class DuoError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Checks a browser request body; returns the request to forward or throws DuoError(400). */
export function parseDuoRequest(body: unknown): DuoRequest {
  if (!body || typeof body !== "object") throw new DuoError("Invalid JSON body", 400);
  const b = body as { messages?: unknown; mode?: unknown; lambda?: unknown };
  if (!Array.isArray(b.messages) || b.messages.length === 0) throw new DuoError("`messages` must be a non-empty array", 400);
  if (b.messages.length > DUO_MAX_MESSAGES) throw new DuoError(`At most ${DUO_MAX_MESSAGES} messages`, 400);
  const messages: DuoMessage[] = b.messages.map((m, i) => {
    const r = m as { role?: unknown; content?: unknown };
    if (r?.role !== "user" && r?.role !== "assistant") throw new DuoError(`messages[${i}].role must be user or assistant`, 400);
    if (typeof r.content !== "string" || !r.content.trim()) throw new DuoError(`messages[${i}].content must be text`, 400);
    if (r.content.length > DUO_MAX_CHARS) throw new DuoError(`messages[${i}] is longer than ${DUO_MAX_CHARS} characters`, 400);
    return { role: r.role, content: r.content };
  });
  if (messages[messages.length - 1].role !== "user") throw new DuoError("The last message must be from the user", 400);
  const mode = b.mode ?? "auto";
  if (mode !== "auto" && mode !== "fast" && mode !== "slow") throw new DuoError("`mode` must be auto, fast or slow", 400);
  let lambda: number | undefined;
  if (b.lambda !== undefined && b.lambda !== null) {
    if (typeof b.lambda !== "number" || !Number.isFinite(b.lambda) || b.lambda < 0 || b.lambda > 1) {
      throw new DuoError("`lambda` must be a number from 0 to 1", 400);
    }
    lambda = b.lambda;
  }
  return { messages, mode, lambda };
}

/** The body the gateway's POST /v1/chat takes. `auto` leaves the decision to the gate. */
export function gatewayBody(r: DuoRequest): Record<string, unknown> {
  return {
    messages: r.messages,
    ...(r.mode !== "auto" ? { force_mode: r.mode } : {}),
    ...(r.lambda !== undefined ? { lambda: r.lambda } : {}),
  };
}

export type DuoStage = { stage: string; ms: number; tokens: number | null; note: string | null };

/** What the Duo page shows: the answer, which system produced it, why, and where the time went. */
export type DuoTrace = {
  answer: string;
  /** "fast" = System 1 answered; "slow" = System 2 answered. */
  mode: "fast" | "slow" | string;
  /** checked / consensus / unverified / … (the gateway's assurance level). */
  assurance: string;
  uncertaintyNotice: string | null;
  degraded: boolean;
  domain: string | null;
  gate: {
    escalate: boolean | null;
    rule: string | null;
    lambda: number | null;
    errorFast: number | null;
    errorSlow: number | null;
    agreement: number | null;
    meanLogprob: number | null;
    verifiable: boolean | null;
    explanation: string | null;
  };
  verifier: { name: string; passed: boolean | null; score: number | null; ms: number | null } | null;
  stages: DuoStage[];
  usage: {
    wallMs: number | null;
    ttftMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    reasoningTokens: number | null;
    modelCalls: number | null;
    verifierCalls: number | null;
  };
  /** System 2's thinking, when it ran; can be long. */
  reasoning: string | null;
  conversationId: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Maps a gateway ChatReply to the trace the page renders. Missing fields become null, never a crash. */
export function toTrace(reply: unknown): DuoTrace {
  const r = obj(reply);
  const message = obj(r.message);
  const usage = obj(r.usage);
  const decision = obj(r.decision);
  const features = obj(decision.features);
  const verifier = r.verifier && typeof r.verifier === "object" ? obj(r.verifier) : null;
  const explanation = decision.explanation;
  return {
    answer: typeof message.content === "string" ? message.content : "",
    mode: str(r.reasoning_mode) ?? "unknown",
    assurance: str(r.assurance) ?? "unknown",
    uncertaintyNotice: str(r.uncertainty_notice),
    degraded: r.degraded === true,
    domain: str(r.domain) ?? str(features.domain),
    gate: {
      escalate: bool(decision.escalate),
      rule: str(decision.rule),
      lambda: num(decision.lambda),
      errorFast: num(decision.e1_hat),
      errorSlow: num(decision.e2_hat),
      agreement: num(features.agreement),
      meanLogprob: num(features.mean_logprob),
      verifiable: bool(features.verifiable),
      explanation: typeof explanation === "string" ? explanation : explanation ? JSON.stringify(explanation) : null,
    },
    verifier: verifier
      ? { name: str(verifier.verifier) ?? "verifier", passed: bool(verifier.passed), score: num(verifier.score), ms: num(verifier.duration_ms) }
      : null,
    stages: (Array.isArray(usage.stages) ? usage.stages : []).map((s) => {
      const o = obj(s);
      return { stage: str(o.stage) ?? "?", ms: num(o.ms) ?? 0, tokens: num(o.tokens), note: str(o.note) };
    }),
    usage: {
      wallMs: num(usage.wall_ms),
      ttftMs: num(usage.ttft_ms),
      promptTokens: num(usage.prompt_tokens),
      completionTokens: num(usage.completion_tokens),
      reasoningTokens: num(usage.reasoning_tokens),
      modelCalls: num(usage.model_calls),
      verifierCalls: num(usage.verifier_calls),
    },
    reasoning: str(r.reasoning),
    conversationId: str(r.conversation_id),
  };
}

/** One chat turn through the gateway. Slow-path answers can take minutes, so the timeout is long. */
export async function duoChat(r: DuoRequest, timeoutMs = 15 * 60_000): Promise<DuoTrace> {
  return toTrace(await duoGateway("/v1/chat", { method: "POST", body: gatewayBody(r), timeoutMs }));
}

/**
 * A call to the gateway with the server-side token. Returns the parsed JSON; throws DuoError with the status to answer
 * the browser with (503 not configured, 502 unreachable or our token refused, otherwise the gateway's own status).
 */
export async function duoGateway(
  path: string,
  { method = "GET", body, timeoutMs = 30_000 }: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}
): Promise<unknown> {
  if (!duoConfigured()) throw new DuoError("The Duo gateway is not configured (DUO_GATEWAY_URL)", 503);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new DuoError(`The Duo gateway is unreachable: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      message = j.message ?? j.error ?? message;
    } catch {
      /* keep the raw text */
    }
    // 401/403 from the gateway means OUR token is wrong: a server problem, not the user's.
    const status = res.status === 401 || res.status === 403 ? 502 : res.status;
    throw new DuoError(`Duo gateway ${res.status}: ${message}`, status);
  }
  if (!text.trim()) return null; // e.g. 202 Accepted on a cancel
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DuoError("The Duo gateway returned something that is not JSON", 502);
  }
}
