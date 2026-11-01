/**
 * Runs a decision-model eval: every test row is sent to the SERVED model, the answers are scored, and
 * progress is written to the run store as it goes. The caller starts it detached (the HTTP response
 * returns as soon as the run is queued), so the page can be closed and reopened.
 *
 * The model answers through the decision server (`POST /v1/systemone`), the same path a client's
 * request takes, so the eval measures the model people actually call, not a separate copy of it.
 */
import {
  buildDecisionReport,
  scoreDecisionCase,
  stateText,
  type DecisionCase,
  type EvalRow,
} from "@/lib/decision-eval";
import {
  pruneDecisionEvalRuns,
  saveDecisionEvalRun,
  type DecisionEvalRun,
} from "@/lib/decision-eval-store";
import { logServerError } from "@/lib/log";

/** The decision server answers one request per model at a time; a few in flight keep it busy without piling up. */
const CONCURRENCY = 3;
const PROGRESS_EVERY = 1;

/** Questions as the server expects them: the row's own, so options and instructions are exactly what the model was trained on. */
export type Predict = (row: EvalRow) => Promise<Record<string, unknown>>;

export async function runDecisionEval(run: DecisionEvalRun, rows: EvalRow[], predict: Predict): Promise<void> {
  const cases: DecisionCase[] = new Array(rows.length);
  let next = 0;
  let completed = 0;
  let errorCount = 0;
  let errorSample: string | undefined;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      try {
        cases[i] = scoreDecisionCase(i, rows[i]!, await predict(rows[i]!), run.meta);
      } catch (err) {
        // A failed request is not a wrong answer: the row is left out of the metrics and counted, so the
        // report says how many rows it really covers instead of quietly scoring them as misses.
        cases[i] = { i, state: stateText(rows[i]!.state), results: {}, error: err instanceof Error ? err.message : String(err) };
        errorCount++;
        errorSample ??= cases[i]!.error;
      }
      completed++;
      if (completed % PROGRESS_EVERY === 0) {
        await saveDecisionEvalRun({ ...run, completed, errorCount, errorSample }).catch(() => {});
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    const report = buildDecisionReport(cases, run.meta, rows.length);
    if (report.decisions === 0) {
      // Nothing was scored: every request failed, or no gold matched the model's questions.
      await saveDecisionEvalRun({
        ...run,
        status: "error",
        completed,
        errorCount,
        errorSample,
        error: errorSample
          ? `No row could be scored: ${errorSample}`
          : "No decision could be scored: the test rows' gold labels did not match any question",
      });
    } else {
      await saveDecisionEvalRun({ ...run, status: "done", completed, errorCount, errorSample, report, cases });
    }
  } catch (err) {
    logServerError("decision eval run", err);
    await saveDecisionEvalRun({
      ...run,
      status: "error",
      completed,
      errorCount,
      errorSample,
      error: err instanceof Error ? err.message : "The eval failed to run",
    }).catch(() => {});
  }
  await pruneDecisionEvalRuns();
}
