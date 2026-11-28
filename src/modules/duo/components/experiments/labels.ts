/**
 * Names, help and presets for the eval strategies (the gateway's `systems`), and null-safe readers for an eval run
 * as /v1/eval/runs/{id} returns it (nafs-eval: systems, paired, routing, calibration, coupling, budget_curve,
 * frontier, items).
 */
import type { Tone } from "@/modules/duo/components/duo-ui";

/** The strategies offered in the form, in the gateway's naming. */
export const STRATEGIES: Array<{ id: string; label: string; hint: string }> = [
  { id: "nafs_aql", label: "Gate with checks", hint: "The full service: System 1's draft is checked before the gate decides whether System 2 should take over." },
  { id: "nafs_blind", label: "Gate, estimate only", hint: "The gate with the checks hidden while it decides, so it relies on its own estimate. The honest test of the routing." },
  { id: "fast_only", label: "System 1 only", hint: "The quick model answers everything at once." },
  { id: "slow_only", label: "System 2 always", hint: "The reasoning model thinks first, without seeing the quick draft." },
  { id: "pre_route", label: "Router before answering", hint: "System 1 reads the question and picks the model before anything is answered (Semantic Router style)." },
  { id: "fast_probe", label: "System 1 with samples", hint: "A quick draft and its agreement samples, with no System 2 call: labelled gate data at the cost of the draft." },
  { id: "slow_conditioned", label: "System 2, sees the draft", hint: "System 2 can see the quick draft, to measure how often a wrong draft is copied." },
  { id: "slow_noexit", label: "System 2, no early stop", hint: "Early stopping switched off: pairs with System 2 always to measure the time early stopping saves." },
  { id: "slow_exit_consistency", label: "System 2, stop when drafts agree", hint: "On open questions the thinking stops after two drafts in a row agree." },
  { id: "slow_exit_posterior", label: "System 2, stop when confident", hint: "On open questions the thinking stops once the leading answer is likely enough to win." },
  { id: "slow_exit_all", label: "System 2, stop when tests pass", hint: "On code and format tasks a draft that passes the exact check is the final answer." },
  { id: "slow_exit_all_decay", label: "System 2, shorter retries", hint: "As 'stop when tests pass', and each retry gets half the previous thinking budget." },
];
const LABEL = Object.fromEntries(STRATEGIES.map((s) => [s.id, s.label]));
const HELP = Object.fromEntries(STRATEGIES.map((s) => [s.id, s.hint]));

/** A strategy id in words, including the λ variants (`nafs_aql_l40`) and budget sweeps (`slow_b512`). */
export function sysLabel(k: string): string {
  if (LABEL[k]) return LABEL[k];
  const m = /^(nafs_aql|nafs_blind)_l(\d{1,3})$/.exec(k);
  if (m) return `${LABEL[m[1]]}, λ ${(Number(m[2]) / 100).toFixed(2)}`;
  const b = /^slow_b(\d+)$/.exec(k);
  if (b) return `System 2, ${b[1]}-token budget`;
  return k;
}
export const sysHelp = (k: string) => HELP[k] ?? "";

/** Strategies that call System 2 on every question (for the time estimate). */
const isSlow = (k: string) => k.startsWith("slow") || k.startsWith("nafs_");

/** A rough duration for a run: System 2 answers take 30 s to a few minutes on the box, System 1 a few seconds. */
export function estimate(n: number, systems: string[]): string {
  if (!n || !systems.length) return "";
  const slow = systems.filter(isSlow).length;
  const fast = systems.length - slow;
  const lo = Math.max(1, Math.round((n * (slow * 30 + fast * 3)) / 60));
  const hi = Math.max(lo, Math.round((n * (slow * 180 + fast * 20)) / 60));
  return `${(n * systems.length).toLocaleString()} answers. Questions run one at a time; expect roughly ${lo}–${hi} minutes in all.`;
}

export type Preset = { title: string; question: string; text: string; dataset: string; n: number; systems: string[] };
export const PRESETS: Preset[] = [
  { title: "Full service", question: "Is the gate as good as always thinking?", text: "The gate with and without checks, against System 1 only and System 2 always.", dataset: "smoke_mixed", n: 12, systems: ["nafs_aql", "nafs_blind", "fast_only", "slow_only"] },
  { title: "Routing study", question: "When should the gate call System 2?", text: "The gate decides from its own estimate, with the checks hidden, and is compared with the best possible choice for each question.", dataset: "gsm8k", n: 20, systems: ["nafs_blind", "fast_only", "slow_only"] },
  { title: "Speed against care", question: "How much care is worth the wait?", text: "The gate at three speed weights; the chart shows which strategies give the most accuracy for their time.", dataset: "gsm8k", n: 15, systems: ["nafs_blind_l05", "nafs_blind_l20", "nafs_blind_l60", "fast_only", "slow_only"] },
  { title: "Independence test", question: "Does System 2 copy a wrong first answer?", text: "System 2 answers with and without sight of the quick draft: how often a wrong draft is repeated.", dataset: "gsm8k", n: 20, systems: ["fast_only", "slow_only", "slow_conditioned"] },
  { title: "Thinking time", question: "How long should it think?", text: "Accuracy at several thinking budgets, and the budget that best balances accuracy and time.", dataset: "gsm8k", n: 15, systems: ["fast_only", "slow_b256", "slow_b512", "slow_only"] },
  { title: "Router or gate", question: "Decide before or after the draft?", text: "A router that picks the model up front, against the gate that decides from the draft.", dataset: "gsm8k", n: 20, systems: ["pre_route", "nafs_aql", "fast_only", "slow_only"] },
  { title: "Early stop", question: "When has it thought enough?", text: "System 2 with and without stopping once a draft checks out: time saved against accuracy.", dataset: "gsm8k", n: 12, systems: ["slow_only", "slow_noexit"] },
  { title: "Stop when tests pass", question: "Can passing tests end the thinking early?", text: "Code answers that stop as soon as the tests pass, with and without shorter retries.", dataset: "mbpp_plus", n: 12, systems: ["slow_only", "slow_exit_all", "slow_exit_all_decay"] },
];

export const GLOSSARY: Array<[string, string]> = [
  ["Accuracy (95% interval)", "Share of questions whose answer passed an exact check, with a 95% interval. With few questions the interval is wide: read the interval, not the single number."],
  ["System 2 share", "Share of questions the gate sent to System 2."],
  ["Routing accuracy", "How often the gate made the best choice: call System 2 only when that makes the answer right and the gain is worth the time. Only 'Gate, estimate only' measures the routing itself."],
  ["Calibration error", "How far the predicted chance that a quick answer is wrong is from what actually happens (0 is perfect). It is trusted only when it is small and measured on many questions."],
  ["Paired difference and 'no worse'", "The accuracy difference between two strategies on the same questions, with a 95% interval. 'No worse' means the interval stays above −3 points; a firm verdict needs at least 700 pairs."],
  ["Time ratio", "One strategy's average time divided by the other's."],
  ["Best trade-offs", "Strategies that no other strategy beats on both accuracy and time (the Pareto frontier)."],
  ["Copy rate", "Share of wrong quick drafts that System 2 repeats when it can see them. It should stay at 5% or less."],
];

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "info" },
  done: { label: "Finished", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "warn" },
  interrupted: { label: "Interrupted", tone: "warn" },
};
export const runStatus = (s: unknown) => RUN_STATUS[typeof s === "string" ? s : ""] ?? { label: typeof s === "string" && s ? s : "Unknown", tone: "neutral" as Tone };
/** Runs the gateway can resume in place (finished answers are kept). */
export const canResume = (s: unknown) => s === "interrupted" || s === "cancelled";

/** What a verification block checks, in words (dataset preview). */
export function checkedBy(v: unknown): string {
  const keys = v && typeof v === "object" ? Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] != null) : [];
  const words = keys.map((k) => ({ reference_answer: "expected answer", tests: "tests", test_code: "tests", json_schema: "format" })[k] ?? k.replace(/_/g, " "));
  return [...new Set(words)].join(", ") || "nothing";
}
