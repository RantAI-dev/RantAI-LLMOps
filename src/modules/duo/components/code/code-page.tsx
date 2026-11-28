"use client";

import { Play, ShieldAlert } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Note, PageIntro, Panel, Pill, Spinner, fmtAgo, fmtMs, rec } from "@/modules/duo/components/duo-ui";
import { CodeRun } from "@/modules/duo/components/code/code-run";
import { SOLUTION, checkForm, clipTask, endOf, isSandboxText, toRuns, type FormErrors, type Run } from "@/modules/duo/components/code/code-lib";
import { useRunFollow } from "@/modules/duo/components/code/use-run";
import { gw, GwError, useGw } from "@/modules/duo/lib/gw";

const SELECT =
  "h-8 w-full rounded-[var(--radius-md)] border border-input bg-background px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50";

/** /duo/code: describe a small program and its tests; the code agent writes it, runs the tests in a sandbox, and tries again. */
export function CodePage() {
  const harness = useGw<unknown>("/v1/harness");
  const system = useGw<unknown>("/v1/system");
  const runsQ = useGw<unknown>("/v1/harness/runs", { refreshMs: 15_000 });
  const { runs, running } = toRuns(runsQ.data);

  const agent = rec(rec(harness.data).code_agent);
  const enabled = harness.data ? agent.enabled !== false : true;
  const defaultSteps = typeof agent.max_steps === "number" ? agent.max_steps : null;
  const defaultModel = agent.model === "system1" ? "the quick model" : agent.model === "system2" ? "the careful model" : null;
  // `security.sandbox_isolation` is false when the host refuses the sandbox (on the GB10 box, user namespaces).
  const sandboxOff = rec(rec(system.data).security).sandbox_isolation === false;

  // ---- which run is shown: the one opened, or else the one that is going
  const [chosen, setChosen] = useState<string | null>(null);
  const liveId = runs.find((r) => r.status === "running")?.id ?? null;
  const followId = chosen ?? liveId;
  const [stopping, setStopping] = useState(false);
  const reloadRuns = runsQ.reload;
  // The hook keeps the newest callback itself, so this need not be stable.
  const onEnd = (r: Run) => {
    setChosen(r.id);
    setStopping(false);
    void reloadRuns();
  };
  const follow = useRunFollow(followId, onEnd);
  const going = follow.run?.status === "running";
  // "Stopping…" lasts only while the run is followed and still going: when the following gives up (the run is gone,
  // or the gateway keeps failing) or the run ends, it is cleared (adjusted during render, not in an effect).
  if (stopping && (follow.error || (follow.run && !going))) setStopping(false);

  // ---- the form
  const ids = useId();
  const [task, setTask] = useState("");
  const [tests, setTests] = useState("");
  const [start, setStart] = useState("");
  const [model, setModel] = useState("");
  const [maxSteps, setMaxSteps] = useState("");
  const [more, setMore] = useState(false);
  const [touched, setTouched] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<GwError | null>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const testsRef = useRef<HTMLTextAreaElement>(null);
  const errors: FormErrors = touched ? checkForm(task, tests).errors : {};

  async function submit() {
    setTouched(true);
    const { errors: errs, tests: list } = checkForm(task, tests);
    if (errs.task) return taskRef.current?.focus();
    if (errs.tests) return testsRef.current?.focus();
    const body: Record<string, unknown> = { task: task.trim(), verification: { tests: list }, files: {} };
    if (start.trim()) (body.files as Record<string, string>)[SOLUTION] = start.endsWith("\n") ? start : `${start}\n`;
    if (model) body.model = model;
    if (maxSteps) body.max_steps = Number(maxSteps);
    setStarting(true);
    setStartError(null);
    try {
      const r = rec(await gw("/v1/harness/runs", { body }));
      if (typeof r.run_id === "string") {
        setStopping(false);
        setChosen(r.run_id);
      }
      void reloadRuns();
    } catch (err) {
      const e = err instanceof GwError ? err : new GwError(String(err), 0);
      if (e.status === 409) {
        toast.info("A run is already going. Open it from Earlier runs, or wait for it to end.");
        void reloadRuns();
      } else setStartError(e);
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    if (!follow.run) return;
    setStopping(true);
    try {
      await gw(`/v1/harness/runs/${encodeURIComponent(follow.run.id)}/stop`, { method: "POST" });
      toast("Stopping after this step…");
    } catch (err) {
      setStopping(false);
      if (err instanceof GwError && err.status === 404) toast.info("The run has already ended.");
      else toast.error("The run could not be stopped", { description: err instanceof GwError ? err.message : undefined });
    }
  }

  function reuseRun(r: Run) {
    setTask(r.request?.task ?? r.task);
    setTests((r.request?.verification?.tests ?? []).join("\n"));
    const s = r.request?.files?.[SOLUTION] ?? "";
    setStart(s);
    if (s) setMore(true);
    setTouched(false);
    taskRef.current?.focus();
    taskRef.current?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  if (harness.error && (harness.error.status === 503 || harness.error.status === 502))
    return <GwErrorState error={harness.error} onRetry={() => void harness.reload(false)} what="the code agent" />;

  const say = starting
    ? "Starting…"
    : going
      ? stopping
        ? "Stopping after this step…"
        : `Step ${(follow.run?.steps.length ?? 0) + 1} of at most ${follow.run?.max_steps ?? "?"}…`
      : follow.run
        ? endOf(follow.run.status)[1]
        : "";

  return (
    <div className="grid gap-3">
      <PageIntro title="Code">
        Describe a small Python function and the tests it must pass. The code agent writes <code>solution.py</code>, runs your tests in a sandbox with no network
        access, and tries again from what failed until they all pass.
      </PageIntro>

      {sandboxOff ? (
        <Note tone="warn" className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            The code sandbox is not available on this server, so programs cannot be run against their tests and runs will stop without a checked answer. Whoever runs
            Semantic Duo needs to allow it on the host (unprivileged user namespaces).
          </span>
        </Note>
      ) : null}
      {harness.data && !enabled ? <Note tone="warn">The code agent is turned off on this server. Whoever runs Semantic Duo can turn it on ([harness] code_agent_enabled).</Note> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="What should the program do?">
          <form
            noValidate
            autoComplete="off"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field id={`${ids}-task`} label="The task" hint="Name the function and say what it takes and returns. The program is written in Python, to a file called solution.py." error={errors.task}>
              <Textarea
                ref={taskRef}
                id={`${ids}-task`}
                rows={4}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Write a function median(xs) that returns the median of a list of numbers."
                aria-invalid={errors.task ? true : undefined}
                aria-describedby={`${ids}-task-hint${errors.task ? ` ${ids}-task-err` : ""}`}
                className="min-h-24"
              />
            </Field>
            <Field
              id={`${ids}-tests`}
              label="Tests it must pass"
              hint={
                <>
                  One Python <code>assert</code> per line. The run ends when they all pass.
                </>
              }
              error={errors.tests}
            >
              <Textarea
                ref={testsRef}
                id={`${ids}-tests`}
                rows={5}
                value={tests}
                onChange={(e) => setTests(e.target.value)}
                spellCheck={false}
                placeholder={"assert median([1, 3, 2]) == 2\nassert median([1, 2, 3, 4]) == 2.5"}
                aria-invalid={errors.tests ? true : undefined}
                aria-describedby={`${ids}-tests-hint${errors.tests ? ` ${ids}-tests-err` : ""}`}
                className="min-h-28 font-mono text-xs leading-5 md:text-xs"
              />
            </Field>

            <div>
              <button
                type="button"
                aria-expanded={more}
                aria-controls={`${ids}-more`}
                onClick={() => setMore((m) => !m)}
                className="rounded text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
              >
                {more ? "Fewer options" : "More options"}
              </button>
              <div id={`${ids}-more`} hidden={!more} className="mt-3 grid gap-4">
                <Field id={`${ids}-start`} label="Starting code (optional)" hint="A solution.py to fix or extend. Leave it empty to start from nothing.">
                  <Textarea
                    id={`${ids}-start`}
                    rows={5}
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    spellCheck={false}
                    placeholder="# a solution.py to fix or extend"
                    aria-describedby={`${ids}-start-hint`}
                    className="min-h-28 font-mono text-xs leading-5 md:text-xs"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Who writes it</span>
                    <select className={SELECT} value={model} onChange={(e) => setModel(e.target.value)}>
                      <option value="">As this service is set up{defaultModel ? ` (${defaultModel})` : ""}</option>
                      <option value="system2">The careful model (slower)</option>
                      <option value="system1">The quick model</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Most attempts</span>
                    <select className={SELECT} value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)}>
                      <option value="">As set up{defaultSteps ? ` (${defaultSteps})` : ""}</option>
                      {[3, 6, 9, 12].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            {startError ? <StartError error={startError} /> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={starting || going || !enabled}>
                {starting ? <Spinner className="size-3.5 text-primary-foreground" /> : <Play aria-hidden />}
                Write and check
              </Button>
              <span className="text-sm text-ink-soft" role="status" aria-live="polite">
                {say}
              </span>
            </div>
          </form>
        </Panel>

        <Panel title="Earlier runs" info="The newest runs on this server. Open one to see its steps and the program it wrote.">
          {runsQ.error && !runsQ.data ? (
            <GwErrorState error={runsQ.error} onRetry={() => void runsQ.reload(false)} what="the runs" />
          ) : runsQ.loading && !runsQ.data ? (
            <Loading />
          ) : runs.length === 0 ? (
            <p className="text-sm text-ink-soft">No runs yet. Describe a small function and its tests, and it is written and checked here.</p>
          ) : (
            <ul className="-mx-2 grid max-h-[28rem] gap-0.5 overflow-y-auto">
              {runs.map((r) => {
                const [tone, l] = endOf(r.status);
                const active = r.id === followId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setStopping(false);
                        setChosen(r.id);
                        if (r.id === followId) follow.retry();
                      }}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none",
                        active ? "bg-primary-soft" : "hover:bg-surface-2"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Pill tone={tone}>{r.status === "running" ? "Working" : l}</Pill>
                        <span className="ml-auto text-xs text-ink-faint">{fmtAgo(r.created_at)}</span>
                      </span>
                      <span className="text-sm break-words">{clipTask(r.task || "Untitled task", 110)}</span>
                      <span className="text-xs text-ink-faint">
                        {typeof r.steps === "number" ? `${r.steps} step${r.steps === 1 ? "" : "s"}` : ""}
                        {typeof r.wall_ms === "number" ? ` · ${fmtMs(r.wall_ms)}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {running && !going && liveId && liveId !== followId ? (
            <p className="mt-2 text-xs text-ink-faint">A run is going now; open it above to watch it.</p>
          ) : null}
        </Panel>
      </div>

      {followId ? (
        <CodeRun
          key={followId}
          run={follow.run}
          error={follow.error}
          retrying={follow.retrying}
          loading={follow.loading}
          stopping={stopping}
          onStop={() => void stop()}
          onRetry={follow.retry}
          onUseAgain={reuseRun}
        />
      ) : null}
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-ink-faint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-err`} role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Why the run did not start: the sandbox refused by the host, the agent turned off, or the gateway's own words. */
function StartError({ error }: { error: GwError }) {
  if (isSandboxText(error.message))
    return (
      <div role="alert" className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
        <p className="font-medium">The code sandbox is not available on this server.</p>
        <p className="mt-1 break-words">{error.message}</p>
      </div>
    );
  return (
    <Note tone="bad">
      The run could not be started: {error.message}
    </Note>
  );
}
