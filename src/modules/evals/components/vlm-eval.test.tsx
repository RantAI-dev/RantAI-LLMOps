import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildVlmReport, type VlmCase } from "@/lib/vlm-eval";
import type { VlmEvalSet } from "@/lib/vlm-eval-set-store";
import type { VlmEvalRun } from "@/lib/vlm-eval-store";
import { VlmEval } from "@/modules/evals/components/vlm-eval";

vi.mock("@/modules/serve/hooks/use-engines", () => ({
  useEngines: () => ({
    loading: false,
    reload: () => {},
    engines: [
      {
        id: "vllm",
        label: "vLLM",
        configured: true,
        available: true,
        models: [
          { id: "base", name: "base", isGguf: false, vision: true },
          { id: "latex-ocr", name: "latex-ocr", isGguf: false, parent: "base", vision: true },
          { id: "text-only", name: "text-only", isGguf: false, vision: false },
        ],
      },
      { id: "sglang", label: "SGLang", configured: false, available: false, models: [] },
    ],
  }),
}));

const SET: VlmEvalSet = { id: "latex-test", name: "latex test", scoring: "latex", rows: 4, images: 4, source: "upload", createdAt: 1 };

const mkCase = (id: number, correct: boolean, over: Partial<VlmCase> = {}): VlmCase => ({
  id,
  image: `images/img${id}.png`,
  prompt: `prompt ${id}`,
  gold: `key${id}`,
  pred: correct ? `key${id}` : `bad${id}`,
  correct,
  score: correct ? 1 : 0,
  cer: correct ? 0 : 0.5,
  ...over,
});

const mkRun = (id: string, model: string, cases: VlmCase[], over: Partial<VlmEvalRun> = {}): VlmEvalRun => ({
  id,
  setId: SET.id,
  setName: SET.name,
  model,
  engine: "vllm",
  scoring: "latex",
  maxTokens: 256,
  status: "done",
  startedAt: Date.now(),
  updatedAt: Date.now(),
  progress: { completed: cases.length, total: cases.length, errors: cases.filter((c) => c.error).length, correct: cases.filter((c) => c.correct).length },
  report: buildVlmReport(cases, "latex"),
  cases,
  ...over,
});

const runA = mkRun("run-a", "base", [mkCase(0, false), mkCase(1, false), mkCase(2, true), mkCase(3, false, { error: "vLLM answered 503", pred: "", correct: false, score: 0, cer: undefined })]);
const runB = mkRun("run-b", "latex-ocr", [mkCase(0, true), mkCase(1, false), mkCase(2, false), mkCase(3, true)]);

let posts: Array<Record<string, unknown>>;
let runs: Record<string, VlmEvalRun>;

beforeEach(() => {
  posts = [];
  runs = { "run-a": runA, "run-b": runB };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/evals/vlm" && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({ runId: "run-b" });
      }
      if (url === "/api/evals/vlm") {
        const { cases: _a, ...a } = runA;
        void _a;
        return Response.json({ runs: [a], sets: [SET] });
      }
      const m = /^\/api\/evals\/vlm\/([\w-]+)$/.exec(url);
      if (m) return Response.json({ run: runs[m[1]!] });
      if (url.startsWith("/api/evals/vlm/sets/")) return Response.json({ set: SET, preview: [] });
      return Response.json({});
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("VlmEval", () => {
  it("offers only models that can read images, and starts a run with the engine, model, set and token limit", async () => {
    const user = userEvent.setup();
    render(<VlmEval />);
    const model = (await screen.findByLabelText("Model (served)")) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole("option", { name: /latex test · 4 rows/ })).toBeInTheDocument());
    const names = within(model).getAllByRole("option").map((o) => o.textContent);
    expect(names.some((n) => n?.startsWith("base"))).toBe(true);
    expect(names.some((n) => n?.startsWith("latex-ocr"))).toBe(true);
    expect(names.some((n) => n?.startsWith("text-only"))).toBe(false);
    expect(screen.getByText(/1 text-only model is hidden/)).toBeInTheDocument();
    // SGLang is not configured, so it is not offered.
    expect(within(screen.getByLabelText("Engine")).queryByRole("option", { name: "SGLang" })).toBeNull();

    await user.selectOptions(model, "latex-ocr");
    await user.clear(screen.getByLabelText("Longest answer (tokens)"));
    await user.type(screen.getByLabelText("Longest answer (tokens)"), "128");
    await user.click(screen.getByRole("button", { name: "Run eval" }));
    await waitFor(() => expect(posts).toEqual([{ engine: "vllm", model: "latex-ocr", setId: "latex-test", maxTokens: 128 }]));
  });

  it("shows the report of a finished run: accuracy with its interval, CER, errors, and a wrong-only filter", async () => {
    const user = userEvent.setup();
    render(<VlmEval />);
    // The run in the history is opened by its time button.
    await user.click(await screen.findByRole("button", { name: /\d{2}\/\d{2}\/\d{4}|\d{1,2}[./-]\d{1,2}/ }));
    expect(await screen.findByText("Exact match")).toBeInTheDocument();
    expect(screen.getAllByText("33.3%").length).toBeGreaterThan(1); // 1 of 3 scored rows: the headline and the history row
    expect(screen.getByText(/95% interval .*1 of 3/)).toBeInTheDocument();
    expect(screen.getByText("Mean CER")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("1 of 4 rows could not be answered and are not counted");

    // All four rows, with a badge each; a failed request is NOT called incorrect.
    expect(screen.getAllByText("correct")).toHaveLength(1);
    expect(screen.getAllByText("incorrect")).toHaveLength(2);
    expect(screen.getAllByText("no answer (error)")).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Show"), "wrong");
    expect(screen.queryByText("correct")).toBeNull();
    expect(screen.getAllByText("incorrect")).toHaveLength(2);
    expect(screen.queryByText("no answer (error)")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Show"), "errors");
    expect(screen.getAllByText("no answer (error)")).toHaveLength(1);
    expect(screen.queryByText("incorrect")).toBeNull();
  });

  it("compares a run with another run on the same set: accuracy change, CER change, and the rows that flipped", async () => {
    const user = userEvent.setup();
    // Start a run (the mock answers run-b), then compare it with run-a from the history.
    render(<VlmEval />);
    await screen.findByLabelText("Model (served)");
    await waitFor(() => expect(screen.getByRole("option", { name: /latex test · 4 rows/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Run eval" }));
    const select = await screen.findByLabelText(/Compare with another run/);
    await user.selectOptions(select, "run-a");
    // A (base): rows 0,1,2 scored, 1 right. B (latex-ocr): 2 of 4 right; paired rows are 0,1,2: B right on 0 only.
    expect(await screen.findByText("Rows compared")).toBeInTheDocument();
    expect(screen.getByText("3 rows scored in both runs")).toBeInTheDocument();
    expect(screen.getByText(/Improved \(wrong in A, right in B\): 1/)).toBeInTheDocument();
    expect(screen.getByText(/Regressed \(right in A, wrong in B\): 1/)).toBeInTheDocument();
    expect(screen.getAllByText("Mean CER").length).toBeGreaterThan(0);
  });
});
