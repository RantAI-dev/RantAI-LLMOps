import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { duoChat, DuoError, gatewayBody, parseDuoRequest, toTrace } from "@/lib/duo";

// Shapes captured from the Rantai-Aql gateway on the GB10 box (16 Nov 2026), trimmed.
const FAST_REPLY = {
  reply_id: "dae27253",
  conversation_id: "27db06cc-a86c-4bd8-93da-314a165ada87",
  reasoning_mode: "fast",
  assurance: "consensus",
  states: ["A", "T"],
  message: { role: "assistant", content: "Step 1: Multiply 12 by 12.\nAnswer: 144" },
  uncertainty_notice: null,
  verifier: null,
  usage: {
    prompt_tokens: 366,
    completion_tokens: 116,
    reasoning_tokens: 0,
    wall_ms: 1378,
    ttft_ms: 63,
    model_calls: 3,
    verifier_calls: 0,
    stages: [
      { stage: "draft", ms: 689, queue_ms: 0, tokens: 39 },
      { stage: "sample_after", ms: 685, queue_ms: 0, tokens: 77, note: "2 samples in parallel, after the draft" },
    ],
  },
  degraded: false,
  draft: null,
  reasoning: null,
  decision: {
    features: { mean_logprob: -0.0145, agreement: 1.0, domain: "math", verifiable: false },
    e1_hat: 0.04,
    e2_hat: 0.02,
    lambda: 0.2,
    escalate: false,
    rule: "fixed",
    explanation: "draft kept: agreement 1.0",
  },
  domain: "math",
};

const SLOW_REPLY = {
  reasoning_mode: "slow",
  assurance: "consensus",
  message: { role: "assistant", content: "An odd integer can be written as 2k + 1 …" },
  verifier: { verifier: "judge", passed: true, score: 1.0, duration_ms: 13128 },
  usage: {
    reasoning_tokens: 364,
    wall_ms: 57533,
    model_calls: 2,
    verifier_calls: 1,
    stages: [
      { stage: "deliberate", ms: 44401, queue_ms: 0, tokens: 466 },
      { stage: "judge", ms: 13128 },
    ],
  },
  reasoning: "[attempt 1]\nOkay, so I need to prove …",
  decision: { features: { agreement: null }, lambda: 0.2, escalate: true, rule: "forced_override", explanation: { why: "forced" } },
};

describe("parseDuoRequest", () => {
  const ok = { messages: [{ role: "user", content: "What is 12 * 12?" }] };

  it("accepts a conversation ending with the user, defaulting to auto", () => {
    expect(parseDuoRequest(ok)).toEqual({ messages: ok.messages, mode: "auto", lambda: undefined });
    expect(parseDuoRequest({ ...ok, mode: "slow", lambda: 0.5 }).lambda).toBe(0.5);
  });

  it("refuses what the gateway would refuse, with 400", () => {
    const bad = [
      null,
      {},
      { messages: [] },
      { messages: [{ role: "system", content: "x" }] },
      { messages: [{ role: "user", content: "  " }] },
      { messages: [{ role: "user", content: "x".repeat(8001) }] },
      { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] },
      { ...ok, mode: "turbo" },
      { ...ok, lambda: 2 },
      { ...ok, lambda: "0.5" },
      { messages: Array.from({ length: 401 }, () => ({ role: "user", content: "x" })) },
    ];
    for (const b of bad) {
      expect(() => parseDuoRequest(b), JSON.stringify(b)?.slice(0, 60)).toThrow(DuoError);
    }
  });
});

describe("gatewayBody", () => {
  it("leaves auto to the gate and forces only fast or slow", () => {
    const messages = [{ role: "user" as const, content: "q" }];
    expect(gatewayBody({ messages, mode: "auto" })).toEqual({ messages });
    expect(gatewayBody({ messages, mode: "slow", lambda: 0.3 })).toEqual({ messages, force_mode: "slow", lambda: 0.3 });
  });
});

describe("toTrace", () => {
  it("reads a System 1 answer kept by the gate", () => {
    const t = toTrace(FAST_REPLY);
    expect(t.mode).toBe("fast");
    expect(t.answer).toContain("144");
    expect(t.gate).toMatchObject({ escalate: false, rule: "fixed", lambda: 0.2, agreement: 1, errorFast: 0.04 });
    expect(t.stages.map((s) => s.stage)).toEqual(["draft", "sample_after"]);
    expect(t.stages[1].note).toContain("2 samples");
    expect(t.usage).toMatchObject({ wallMs: 1378, modelCalls: 3, verifierCalls: 0 });
    expect(t.verifier).toBeNull();
    expect(t.domain).toBe("math");
  });

  it("reads a System 2 answer with its judge and reasoning", () => {
    const t = toTrace(SLOW_REPLY);
    expect(t.mode).toBe("slow");
    expect(t.gate.escalate).toBe(true);
    expect(t.gate.explanation).toContain("forced");
    expect(t.verifier).toEqual({ name: "judge", passed: true, score: 1, ms: 13128 });
    expect(t.stages.find((s) => s.stage === "judge")?.tokens).toBeNull();
    expect(t.reasoning).toContain("attempt 1");
  });

  it("never throws on a reply missing everything", () => {
    for (const r of [null, undefined, "x", 3, {}, { usage: { stages: "no" }, decision: 5 }]) {
      const t = toTrace(r);
      expect(t.answer).toBe("");
      expect(t.stages).toEqual([]);
      expect(t.mode).toBe("unknown");
    }
  });
});

describe("duoChat", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DUO_GATEWAY_URL", "http://rantai-aql:8080/");
    vi.stubEnv("DUO_GATEWAY_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });
  const req = { messages: [{ role: "user" as const, content: "q" }], mode: "auto" as const };

  it("posts to /v1/chat with the server-side token and returns the trace", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(FAST_REPLY), { status: 200 }));
    const t = await duoChat(req);
    expect(t.answer).toContain("144");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://rantai-aql:8080/v1/chat");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ messages: req.messages });
  });

  it("reports a gateway that rejects our token as a server fault (502), not the user's", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "E_AUTH", message: "unknown token" }), { status: 401 }));
    await expect(duoChat(req)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("unknown token") });
  });

  it("passes the gateway's own 400 through", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "bad request: too long" }), { status: 400 }));
    await expect(duoChat(req)).rejects.toMatchObject({ status: 400 });
  });

  it("is 503 when not configured and 502 when unreachable", async () => {
    vi.stubEnv("DUO_GATEWAY_URL", "");
    await expect(duoChat(req)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("DUO_GATEWAY_URL", "http://rantai-aql:8080");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(duoChat(req)).rejects.toMatchObject({ status: 502 });
  });
});
