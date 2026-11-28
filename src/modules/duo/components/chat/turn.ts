/**
 * One assistant turn while it streams from POST /v1/chat/stream, and after. A pure reducer over the gateway's SSE
 * events (StreamEvent in the gateway's OpenAPI): start, phase, token, decision, verification, retry, degraded, done,
 * error. The page renders a LiveTurn; a finished one carries the gateway's ChatReply in `reply`.
 */

export type Rec = Record<string, unknown>;

export type Verification = { kind: string; result: Rec };
export type TurnEvent = { t: number; kind: string; text: string };

export type LiveTurn = {
  /** System 1's text (the draft, and the answer when it is kept). */
  fast: string;
  /** System 2's answer text. */
  slow: string;
  /** System 2's thinking, when the request asked for it. */
  reasoning: string;
  domain: string | null;
  backend: string | null;
  phase: string | null;
  phaseLabel: string | null;
  states: string[];
  decision: Rec | null;
  escalated: boolean;
  verifications: Verification[];
  degraded: string | null;
  error: string | null;
  stopped: boolean;
  reply: Rec | null;
  conversationId: string | null;
  events: TurnEvent[];
  startedAt: number;
  firstTokenMs: number | null;
};

export function newTurn(now = Date.now()): LiveTurn {
  return {
    fast: "",
    slow: "",
    reasoning: "",
    domain: null,
    backend: null,
    phase: null,
    phaseLabel: null,
    states: [],
    decision: null,
    escalated: false,
    verifications: [],
    degraded: null,
    error: null,
    stopped: false,
    reply: null,
    conversationId: null,
    events: [],
    startedAt: now,
    firstTokenMs: null,
  };
}

const s = (v: unknown) => (typeof v === "string" ? v : "");
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

/** Apply one SSE event. `payload` is the event's JSON (`{event, data}`); a bare data object is accepted too. */
export function applyEvent(t: LiveTurn, event: string, payload: unknown, now = Date.now()): LiveTurn {
  const p = rec(payload);
  const d = "data" in p && p.data && typeof p.data === "object" ? rec(p.data) : p;
  const at = now - t.startedAt;
  const log = (kind: string, text: string) => [...t.events, { t: at, kind, text }];
  switch (event) {
    case "start":
      return { ...t, domain: s(d.domain) || null, backend: s(d.backend) || null, conversationId: s(d.conversation_id) || t.conversationId, events: log("start", `Started${d.domain ? ` · topic ${s(d.domain)}` : ""}`) };
    case "phase": {
      const state = s(d.state);
      const states = state && t.states[t.states.length - 1] !== state ? [...t.states, state] : t.states;
      return { ...t, phase: state || t.phase, phaseLabel: s(d.label) || t.phaseLabel, states, events: log("phase", s(d.label) || state) };
    }
    case "token": {
      const text = s(d.text);
      const first = t.firstTokenMs === null && text ? at : t.firstTokenMs;
      const events = t.firstTokenMs === null && text ? log("token", "First words") : t.events;
      if (d.mode === "fast") return { ...t, fast: t.fast + text, firstTokenMs: first, events };
      if (d.reasoning === true) return { ...t, reasoning: t.reasoning + text, firstTokenMs: first, events };
      return { ...t, slow: t.slow + text, firstTokenMs: first, events };
    }
    case "decision": {
      const esc = d.escalate === true;
      return { ...t, decision: d, escalated: esc, events: log("decision", `${esc ? "Thinking longer" : "Kept the quick answer"}${d.explanation ? ` — ${s(d.explanation)}` : ""}`) };
    }
    case "verification": {
      const result = rec(d.result);
      const kind = t.decision ? `attempt ${t.verifications.filter((v) => v.kind !== "draft").length + 1}` : "draft";
      return {
        ...t,
        verifications: [...t.verifications, { kind, result }],
        events: log("verify", `${s(result.verifier) || "check"}: ${result.passed === true ? "passed" : "failed"}`),
      };
    }
    case "retry":
      return { ...t, reasoning: t.slow ? `${t.reasoning}\n[previous candidate rejected]\n` : t.reasoning, slow: "", events: log("retry", "Attempt rejected; trying again") };
    case "degraded":
      return { ...t, degraded: s(d.reason) || "degraded", events: log("degraded", s(d.reason) || "A model is not available; answered with what is") };
    case "done": {
      const msg = rec(d.message);
      const content = s(msg.content);
      const slow = d.reasoning_mode === "slow";
      return {
        ...t,
        reply: d,
        decision: d.decision ? rec(d.decision) : t.decision,
        escalated: slow,
        states: Array.isArray(d.states) ? (d.states as string[]) : t.states,
        conversationId: s(d.conversation_id) || t.conversationId,
        // the final text is the gateway's, whatever streamed
        fast: slow ? t.fast : content || t.fast,
        slow: slow ? content || t.slow : t.slow,
        reasoning: s(d.reasoning) || t.reasoning,
        events: log("done", "Done"),
      };
    }
    case "error":
      return { ...t, error: s(d.message) || s(p.message) || "The answer failed", events: log("error", s(d.message) || "Error") };
    default:
      return t;
  }
}

export const isLive = (t: LiveTurn) => !t.reply && !t.error && !t.stopped;

/** The text to show as the answer: System 2's once the gate escalated, otherwise System 1's. */
export function answerText(t: LiveTurn): string {
  if (t.reply) return s(rec(t.reply.message).content) || (t.escalated ? t.slow : t.fast);
  return t.escalated ? t.slow : t.fast;
}

/** A finished turn rebuilt from a stored conversation message (no stream). */
export function turnFromStored(m: Rec): LiveTurn {
  const t = newTurn(0);
  const reply = m.reply && typeof m.reply === "object" ? rec(m.reply) : null;
  const mode = s(m.reasoning_mode) || s(reply?.reasoning_mode);
  const content = s(m.content);
  return {
    ...t,
    reply: reply ?? {
      reasoning_mode: mode || "fast",
      assurance: s(m.assurance) || "unverified",
      decision_id: s(m.decision_id) || null,
      reply_id: s(m.reply_id) || null,
      message: { role: "assistant", content },
    },
    escalated: mode === "slow",
    fast: mode === "slow" ? "" : content,
    slow: mode === "slow" ? content : "",
    decision: reply?.decision ? rec(reply.decision) : null,
  };
}

export const ASSURANCE: Record<string, { label: string; tone: "good" | "info" | "neutral" | "warn"; hint: string }> = {
  verified: { label: "Checked", tone: "good", hint: "An exact check (calculation, tests, format) confirmed the answer" },
  consensus: { label: "Cross-checked", tone: "info", hint: "Independent answers agreed. Agreement is not proof" },
  unverified: { label: "Not checked", tone: "neutral", hint: "This kind of answer could not be checked" },
  abstained: { label: "Withheld", tone: "warn", hint: "No answer earned acceptance within the budget" },
};
export function assuranceOf(v: unknown) {
  const k = s(v).toLowerCase();
  return ASSURANCE[k] ?? { label: k ? k[0].toUpperCase() + k.slice(1) : "Not checked", tone: "neutral" as const, hint: "" };
}

/** The gate's automaton states (TraceState in the OpenAPI), in the original app's words. */
export const STATE_LABEL: Record<string, { label: string; tip: string }> = {
  A: { label: "Draft", tip: "The quick model answers at once: the first, unexamined response." },
  L: { label: "Flagged", tip: "The routing or a check finds the draft wanting." },
  M: { label: "Thinking", tip: "The thorough model reasons within a budget, without seeing the draft." },
  T: { label: "Accepted", tip: "The answer is accepted with a stated assurance." },
  X: { label: "Abstain", tip: "Judgement withheld: no candidate earned acceptance within the budget." },
  C: { label: "Reused", tip: "A method worked out earlier ran again with this question's values; no model had to think." },
};
