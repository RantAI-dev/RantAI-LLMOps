/**
 * Plain-language names for the gateway's codes (engines, reply modes, assurance levels), shared by the Status,
 * Speed and Experiments sections. The wording follows the original Nafs-Aql web app.
 */
import type { Tone } from "@/modules/duo/components/duo-ui";

/** The inference engine behind a backend (`kind` in /v1/system). */
export function engineName(kind: unknown): string {
  const k = typeof kind === "string" ? kind : "";
  return (
    { vllm: "vLLM", llama: "llama.cpp", smiley: "Smiley Core", peregrine: "Peregrine", sglang: "SGLang", openai: "OpenAI-compatible server" }[k] ??
    (k || "Unknown engine")
  );
}

/** A reply's mode: `fast` is System 1 alone, `slow` means System 2 took over. */
export function modeInfo(mode: unknown): { label: string; tone: Tone; hint: string } {
  if (mode === "slow") return { label: "System 2", tone: "slow", hint: "The reasoning model thought it through" };
  if (mode === "fast") return { label: "System 1", tone: "fast", hint: "The quick model answered at once" };
  if (mode === "cache") return { label: "Cache", tone: "good", hint: "Answered by a stored method" };
  return { label: typeof mode === "string" && mode ? mode : "–", tone: "neutral", hint: "" };
}

/** How sure an answer is (`assurance` on replies and eval items). */
export function assuranceInfo(a: unknown): { label: string; tone: Tone; hint: string } {
  switch (a) {
    case "verified":
      return { label: "Checked", tone: "good", hint: "Checked exactly: it passed the tests, matched the expected answer, or fits the required format." };
    case "consensus":
      return { label: "Cross-checked", tone: "info", hint: "Several independent attempts agree, or a review found it sound. A good sign, not a proof." };
    case "abstained":
      return { label: "Not sure", tone: "warn", hint: "No answer passed the checks in the time allowed, so this one comes with a caution." };
    case "error":
      return { label: "Failed", tone: "bad", hint: "The answer could not be produced." };
    case "unverified":
      return { label: "Not checked", tone: "neutral", hint: "There is no exact way to check this kind of answer." };
    default:
      return { label: typeof a === "string" && a ? a : "–", tone: "neutral", hint: "" };
  }
}

/** The gate's decision rule (`effective_rule`). */
export function ruleName(rule: unknown): string {
  return (
    { fixed: "Simple rule", calibrated: "Learned rule", budget: "Fixed share" }[typeof rule === "string" ? rule : ""] ??
    (typeof rule === "string" && rule ? rule : "–")
  );
}
