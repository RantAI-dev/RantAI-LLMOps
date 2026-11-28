/**
 * Shapes and plain-language labels for the Code section: the gateway's code agent (`/v1/harness/runs`). Field names
 * follow rust/crates/nafs-gateway/src/agent_runs.rs and `CodeAgentStep` / `CodeAgentReply` in nafs-types.
 */

import type { Tone } from "@/modules/duo/components/duo-ui";
import { arr, rec } from "@/modules/duo/components/duo-ui";

/** What a step did, in words. */
export const ACTION: Record<string, string> = {
  write: "wrote the program",
  patch: "changed the program",
  run: "ran a file to try something",
  none: "gave a reply that could not be used",
  rejected: "wrote a change that does not compile, so it was refused",
  submit: "said it was finished",
  model_error: "could not be reached",
};

/** How a run ended: tone and label. */
export const END: Record<string, [Tone, string]> = {
  running: ["info", "Working"],
  verified: ["good", "All the tests pass"],
  exhausted: ["warn", "Out of attempts"],
  deadline: ["warn", "Out of time"],
  stuck: ["warn", "Stopped: it kept failing the same way"],
  stopped: ["warn", "Stopped by you"],
  model_error: ["bad", "The model could not be reached"],
  failed: ["bad", "The run failed"],
  interrupted: ["warn", "Interrupted: the service restarted"],
};
export const endOf = (status: string): [Tone, string] => END[status] ?? ["warn", status || "Unknown"];

export type Step = {
  step: number;
  action: string;
  observation?: string;
  passed?: boolean;
  score?: number;
  ms?: number;
  model?: string;
  samples?: number;
  retries?: number;
  rolled_back?: boolean;
  compacted?: boolean;
};

export type RunResult = {
  status?: string;
  passed?: boolean;
  score?: number;
  files?: Record<string, string>;
  evidence?: string;
  wall_ms?: number;
  model_calls?: number;
  verifier_calls?: number;
  prefill_tokens?: number;
  cached_tokens?: number;
  decoded_tokens?: number;
  diff?: string;
};

export type Run = {
  id: string;
  status: string;
  task: string;
  created_at?: string;
  ended_at?: string;
  model?: string;
  max_steps?: number;
  tests?: number;
  steps: Step[];
  result: RunResult | null;
  error?: string;
  request?: { task?: string; files?: Record<string, string>; verification?: { tests?: string[] } };
};

export type RunSummary = { id: string; status: string; task: string; created_at?: string; model?: string; steps?: number; passed?: boolean | null; wall_ms?: number | null };

export const SOLUTION = "solution.py";
export const MAX_TASK = 20_000;
export const MAX_TESTS = 60;

export function toRun(d: unknown): Run | null {
  const r = rec(d);
  if (typeof r.id !== "string") return null;
  const steps = arr(r.steps)
    .map((x) => rec(x))
    .filter((x) => typeof x.step === "number")
    .map((x) => x as unknown as Step);
  const res = r.result && typeof r.result === "object" ? (r.result as RunResult) : null;
  return {
    ...(r as Partial<Run>),
    id: r.id,
    status: typeof r.status === "string" ? r.status : "running",
    task: typeof r.task === "string" ? r.task : "",
    steps,
    result: res,
    error: typeof r.error === "string" ? r.error : undefined,
    request: r.request && typeof r.request === "object" ? (r.request as Run["request"]) : undefined,
  };
}

export function toRuns(d: unknown): { runs: RunSummary[]; running: boolean } {
  const r = rec(d);
  const runs = arr(r.runs)
    .map((x) => rec(x))
    .filter((x) => typeof x.id === "string")
    .map((x) => ({ ...x, status: typeof x.status === "string" ? x.status : "running", task: typeof x.task === "string" ? x.task : "" }) as RunSummary);
  return { runs, running: r.running === true || runs.some((x) => x.status === "running") };
}

export type FormErrors = { task?: string; tests?: string };

/** The form's checks (as in the original): a real task, and one Python `assert` per line. */
export function checkForm(task: string, testsText: string): { errors: FormErrors; tests: string[] } {
  const t = task.trim();
  const tests = testsText
    .split("\n")
    .map((x) => x.trimEnd())
    .filter((x) => x.trim());
  const errors: FormErrors = {};
  if (t.length < 12) errors.task = "Describe the task in a sentence or two.";
  else if (t.length > MAX_TASK) errors.task = `Keep the task under ${MAX_TASK.toLocaleString()} characters.`;
  const bad = tests.findIndex((x) => !/^\s*assert\b/.test(x));
  if (!tests.length) errors.tests = "Give at least one test, so the result can be checked.";
  else if (bad >= 0) errors.tests = `Line ${bad + 1} is not an assert. Write each test like: assert f(2) == 4`;
  else if (tests.length > MAX_TESTS) errors.tests = `At most ${MAX_TESTS} tests.`;
  return { errors, tests };
}

const SANDBOX_RE = /sandbox (isolation is not available|setup failed|could not run)|refusing to run untrusted code|unprivileged user|apparmor_restrict_unprivileged_userns/i;

/** The gateway's words when the code sandbox was refused by the host, from a run's error or its steps. */
export function sandboxProblem(run: Run | null): string | null {
  if (!run) return null;
  if (run.error && SANDBOX_RE.test(run.error)) return run.error;
  if (run.result?.evidence && SANDBOX_RE.test(run.result.evidence)) return run.result.evidence;
  for (const s of run.steps) if (s.observation && SANDBOX_RE.test(s.observation)) return s.observation.slice(0, 1200);
  return null;
}

export const isSandboxText = (t: string | null | undefined) => !!t && SANDBOX_RE.test(t);

export const who = (model: string | undefined) => (model === "system1" ? "The quick model" : "The careful model");
export const pct = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? `${Math.round(x * 100)}%` : "–");
export const clipTask = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
