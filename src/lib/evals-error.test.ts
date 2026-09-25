import { describe, expect, it } from "vitest";

import { evalErrorFromLog } from "@/lib/evals";

/**
 * Reading the cause out of a failed eval log.
 *
 * The job list carries no error field, so until this existed a FAILED run showed
 * a red chip and nothing else — the reason lived a few thousand lines into the
 * log, under all of `uv pip install`. These cases are shaped like the real logs
 * on the box, including the one that actually failed 17 runs on 24 Sep.
 */
describe("evalErrorFromLog", () => {
  it("pulls the exception out of a Python traceback", () => {
    // Trimmed from job 124a3f7c on the box: the cause is the last line, under
    // ~6.8 KB of package installs.
    const log = [
      "Using Python 3.11.15 environment at: venv",
      " + lm-eval==0.4.7",
      " + numexpr==2.14.2",
      "Traceback (most recent call last):",
      '  File "/root/.transformerlab/.../lm_eval/__main__.py", line 382, in cli_evaluate',
      "    results = evaluator.simple_evaluate(",
      '  File "/root/.transformerlab/.../lm_eval/api/model.py", line 147, in create_from_arg_string',
      "    return cls(**args, **args2)",
      "TypeError: HFLM.__init__() missing 1 required positional argument: 'pretrained'",
    ].join("\n");

    expect(evalErrorFromLog(log)).toBe(
      "TypeError: HFLM.__init__() missing 1 required positional argument: 'pretrained'"
    );
  });

  it("takes the LAST exception when the harness re-raises", () => {
    const log = [
      "ValueError: first failure, caught and re-raised",
      "Traceback (most recent call last):",
      "RuntimeError: the one that actually killed it",
    ].join("\n");

    expect(evalErrorFromLog(log)).toBe("RuntimeError: the one that actually killed it");
  });

  it("never returns a bare Traceback line, which names no cause", () => {
    // A truncated log can end mid-traceback. "Traceback (most recent call last):"
    // in the list would be worse than an empty cell: it looks like information.
    const log = ["installing…", "Traceback (most recent call last):"].join("\n");
    expect(evalErrorFromLog(log)).toBe("");
  });

  it("falls back to the harness exit marker when no traceback unwound", () => {
    const log = ["loading model…", "⚠️  Evaluation returned non-zero exit code: 1"].join("\n");
    expect(evalErrorFromLog(log)).toBe("Evaluation returned non-zero exit code: 1");
  });

  it("catches an OOM that killed the process before any Python frame", () => {
    const log = ["Loading checkpoint shards:  50%", "CUDA out of memory. Tried to allocate 2.00 GiB"].join(
      "\n"
    );
    expect(evalErrorFromLog(log)).toBe("CUDA out of memory. Tried to allocate 2.00 GiB");
  });

  it("returns empty for a log with nothing to report", () => {
    expect(evalErrorFromLog("Installed 23 packages in 34ms\nRunning…")).toBe("");
    expect(evalErrorFromLog("")).toBe("");
  });

  it("handles CRLF logs", () => {
    expect(evalErrorFromLog("setup\r\nOSError: no such file\r\n")).toBe("OSError: no such file");
  });

  it("truncates a reason too long for a table cell", () => {
    const long = `ValueError: ${"x".repeat(400)}`;
    const got = evalErrorFromLog(long);
    expect(got.length).toBeLessThanOrEqual(240);
    expect(got.endsWith("…")).toBe(true);
  });
});
