/** Words for the reasoning cache (Nafs-Aql's ARC, /v1/arc): entry states and how a question was matched. */
import type { Tone } from "@/modules/duo/components/duo-ui";

export type ArcStatus = "trusted" | "candidate" | "quarantined";

export const ARC_STATUS: Record<ArcStatus, { label: string; tone: Tone; hint: string; action: string }> = {
  trusted: { label: "Answers", tone: "good", hint: "Agreed with the models often enough: it answers questions on its own.", action: "Let it answer" },
  candidate: { label: "On trial", tone: "warn", hint: "Runs beside the models to compare, and never answers until it has agreed with them enough times.", action: "Put on trial" },
  quarantined: { label: "Stopped", tone: "bad", hint: "Disagreed with a checked answer: kept for inspection, never run.", action: "Stop it" },
};
export const arcStatus = (s: unknown) =>
  ARC_STATUS[s as ArcStatus] ?? { label: typeof s === "string" && s ? s : "Unknown", tone: "neutral" as Tone, hint: "", action: "" };

/** How /v1/arc/try matched the question (`tier`). */
export function tierName(t: unknown): string {
  return { template: "pattern", shape: "same words, other numbers", meaning: "meaning" }[typeof t === "string" ? t : ""] ?? (typeof t === "string" ? t : "–");
}
