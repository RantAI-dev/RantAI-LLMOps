import { describe, expect, it } from "vitest";

import { answerText, applyEvent, assuranceOf, isLive, newTurn, turnFromStored } from "@/modules/duo/components/chat/turn";

const ev = (t: ReturnType<typeof newTurn>, event: string, data: unknown, now = 1000) => applyEvent(t, event, { event, data }, now);

describe("turn reducer", () => {
  it("streams a kept System 1 answer", () => {
    let t = newTurn(0);
    t = ev(t, "start", { request_id: "r", conversation_id: "c1", domain: "math", backend: "vllm" }, 10);
    t = ev(t, "phase", { state: "A", label: "Drafting" }, 20);
    t = ev(t, "token", { text: "Answer: ", mode: "fast", reasoning: false, round: 0 }, 300);
    t = ev(t, "token", { text: "145", mode: "fast", reasoning: false, round: 0 }, 310);
    expect(answerText(t)).toBe("Answer: 145");
    expect(t.firstTokenMs).toBe(300);
    expect(t.conversationId).toBe("c1");
    expect(isLive(t)).toBe(true);
    t = ev(t, "decision", { escalate: false, rule: "fixed", explanation: "agreement 1.0", e1_hat: 0.04, e2_hat: 0.02 });
    t = ev(t, "done", { reasoning_mode: "fast", assurance: "verified", message: { role: "assistant", content: "Answer: 145" }, states: ["A", "T"], conversation_id: "c1" });
    expect(isLive(t)).toBe(false);
    expect(t.escalated).toBe(false);
    expect(t.states).toEqual(["A", "T"]);
    expect(t.events.map((e) => e.kind)).toEqual(["start", "phase", "token", "decision", "done"]);
  });

  it("switches to System 2's text on escalation and keeps reasoning apart", () => {
    let t = newTurn(0);
    t = ev(t, "token", { text: "draft", mode: "fast", reasoning: false, round: 0 });
    t = ev(t, "decision", { escalate: true, rule: "threshold" });
    expect(answerText(t)).toBe(""); // System 2 has not written yet
    t = ev(t, "token", { text: "let me think", mode: "slow", reasoning: true, round: 1 });
    t = ev(t, "token", { text: "The ball costs $0.05", mode: "slow", reasoning: false, round: 1 });
    expect(answerText(t)).toBe("The ball costs $0.05");
    expect(t.reasoning).toBe("let me think");
    t = ev(t, "retry", {});
    expect(t.slow).toBe("");
    expect(t.reasoning).toContain("[previous candidate rejected]");
  });

  it("numbers verification attempts after the decision", () => {
    let t = newTurn(0);
    t = ev(t, "verification", { result: { verifier: "math", passed: false } });
    t = ev(t, "decision", { escalate: true });
    t = ev(t, "verification", { result: { verifier: "math", passed: true } });
    expect(t.verifications.map((v) => v.kind)).toEqual(["draft", "attempt 1"]);
  });

  it("records errors and degraded service", () => {
    let t = newTurn(0);
    t = ev(t, "degraded", { reason: "System 2 is not available" });
    expect(t.degraded).toBe("System 2 is not available");
    t = ev(t, "error", { message: "backend timeout" });
    expect(t.error).toBe("backend timeout");
    expect(isLive(t)).toBe(false);
  });

  it("ignores unknown events and missing fields", () => {
    const t = newTurn(0);
    expect(ev(t, "mystery", { x: 1 })).toBe(t);
    expect(ev(t, "token", {}).fast).toBe("");
  });

  it("rebuilds a stored message", () => {
    const t = turnFromStored({ role: "assistant", content: "Hi", reasoning_mode: "slow", assurance: "consensus", decision_id: "d1" });
    expect(t.escalated).toBe(true);
    expect(answerText(t)).toBe("Hi");
    expect(isLive(t)).toBe(false);
  });

  it("labels assurance in plain words", () => {
    expect(assuranceOf("verified").label).toBe("Checked");
    expect(assuranceOf("consensus").label).toBe("Cross-checked");
    expect(assuranceOf(undefined).label).toBe("Not checked");
  });
});
