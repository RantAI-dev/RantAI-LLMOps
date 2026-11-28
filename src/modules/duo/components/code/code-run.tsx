"use client";

import { CheckCircle2, ChevronDown, ChevronRight, Copy, Download, RotateCcw, ShieldAlert, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CodeBlock, GwErrorState, Note, Panel, Pill, Spinner, fmtInt, fmtMs } from "@/modules/duo/components/duo-ui";
import { ACTION, SOLUTION, clipTask, endOf, pct, sandboxProblem, who, type Run, type Step } from "@/modules/duo/components/code/code-lib";
import type { GwError } from "@/modules/duo/lib/gw";
import { saveBlob } from "@/modules/duo/lib/gw";

/** The run being watched: its steps as they end, the files, and how it ended. */
export function CodeRun({
  run,
  error,
  retrying,
  loading,
  stopping,
  onStop,
  onRetry,
  onUseAgain,
}: {
  run: Run | null;
  error: GwError | null;
  retrying: boolean;
  loading: boolean;
  stopping: boolean;
  onStop: () => void;
  onRetry: () => void;
  onUseAgain: (run: Run) => void;
}) {
  if (!run) {
    if (error) return <GwErrorState error={error} onRetry={onRetry} what="the run" />;
    if (loading)
      return (
        <Panel>
          <div className="flex items-center gap-2 text-sm text-ink-soft" role="status">
            <Spinner /> {retrying ? "The run could not be read just now; trying again…" : "Opening the run…"}
          </div>
        </Panel>
      );
    return null;
  }

  const going = run.status === "running";
  const steps = run.steps;
  const res = run.result;
  const [tone, endLabel] = endOf(run.status);
  const label = going ? `Working: step ${steps.length + 1} of at most ${run.max_steps ?? "?"}` : endLabel;
  const files = res?.files && typeof res.files === "object" ? res.files : {};
  const main = typeof files[SOLUTION] === "string" ? files[SOLUTION] : null;
  const others = Object.keys(files).filter((k) => k !== SOLUTION && typeof files[k] === "string");
  const sandbox = sandboxProblem(run);
  const tail = going
    ? ""
    : run.status === "verified"
      ? ""
      : res && typeof res.score === "number"
        ? ` The best version passes ${pct(res.score)} of the tests.`
        : run.error && !sandbox
          ? ` ${run.error}`
          : "";
  const timing = res ? ` ${steps.length} step${steps.length === 1 ? "" : "s"} in ${fmtMs(res.wall_ms)}.` : "";

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {going ? <Spinner className="text-primary" /> : run.status === "verified" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : null}
          {label}
        </span>
      }
      actions={
        going ? (
          <Button type="button" size="sm" variant="destructive" onClick={onStop} disabled={stopping}>
            <Square aria-hidden /> {stopping ? "Stopping after this step…" : "Stop"}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => onUseAgain(run)}>
            <RotateCcw aria-hidden /> Use these again
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm break-words text-ink-soft" title={run.task}>
        {clipTask(run.task, 240)}
      </p>

      <Note tone={going ? "info" : tone} className="mb-3">
        {going ? "Each step appears here as it ends. A step can take a minute or two." : `${endLabel}.${tail}${timing}`}
      </Note>

      {sandbox ? (
        <div role="alert" className="mb-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-4 shrink-0" aria-hidden /> The code sandbox is not available on this server
          </p>
          <p className="mt-1">The program could not be run against your tests, because the host refused the sandbox. Ask whoever runs Semantic Duo to allow it. The gateway said:</p>
          <CodeBlock className="mt-2 max-h-40 border-danger-border bg-background text-foreground">{sandbox}</CodeBlock>
        </div>
      ) : null}

      {error ? (
        <Note tone="bad" className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex-1">The run could not be read: {error.message}</span>
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </Note>
      ) : retrying ? (
        <Note tone="warn" className="mb-3">
          The run could not be read just now; trying again…
        </Note>
      ) : null}

      {steps.length ? (
        <Steps steps={steps} />
      ) : going ? (
        <p className="text-sm text-ink-soft">Waiting for the first step…</p>
      ) : null}

      {main !== null ? (
        <FileView name={SOLUTION} content={main} heading={run.status === "verified" ? "The program" : "The best version so far"} />
      ) : null}
      {others.map((k) => (
        <Collapsible key={k} label={k}>
          <FileView name={k} content={files[k]} />
        </Collapsible>
      ))}
      {res?.diff ? (
        <Collapsible label="What changed from the starting code">
          <CodeBlock className="max-h-96">{res.diff}</CodeBlock>
        </Collapsible>
      ) : null}
      {res ? (
        <p className="mt-3 text-xs text-ink-faint">
          {fmtInt(res.model_calls)} model calls, {fmtInt(res.verifier_calls)} test runs, {fmtInt(res.prefill_tokens)} tokens read ({fmtInt(res.cached_tokens)} already read),{" "}
          {fmtInt(res.decoded_tokens)} written.
        </p>
      ) : null}
    </Panel>
  );
}

/** The steps, newest open by default; a step the person opened or closed stays that way as new steps arrive. */
function Steps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const lastStep = steps[steps.length - 1]?.step;
  return (
    <ol className="mb-3 grid gap-1.5" aria-label="Steps">
      {steps.map((st) => {
        const isOpen = open[st.step] ?? st.step === lastStep;
        const id = `cg-step-${st.step}`;
        return (
          <li key={st.step} className="rounded-md border border-hairline bg-background">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={id}
              onClick={() => setOpen((o) => ({ ...o, [st.step]: !isOpen }))}
              className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
            >
              {isOpen ? <ChevronDown className="size-4 shrink-0 text-ink-faint" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />}
              <span className="font-semibold">Step {st.step}</span>
              <span className="min-w-0 flex-1 text-ink-soft">
                {who(st.model)} {ACTION[st.action] ?? st.action}
                {typeof st.samples === "number" && st.samples > 1 ? ` (${st.samples} tries at once)` : ""}
                {st.rolled_back ? ", and the change was undone because it did worse" : ""}
              </span>
              {st.passed === true ? (
                <Pill tone="good">tests pass</Pill>
              ) : st.passed === false ? (
                <Pill tone="warn">tests fail{typeof st.score === "number" ? `: ${pct(st.score)} pass` : ""}</Pill>
              ) : null}
              <span className="text-xs text-ink-faint tabular-nums">{fmtMs(st.ms)}</span>
            </button>
            <div id={id} hidden={!isOpen} className="px-3 pb-3">
              {st.observation ? <CodeBlock className="max-h-72">{st.observation}</CodeBlock> : <p className="text-xs text-ink-faint">Nothing came back from this step.</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FileView({ name, content, heading }: { name: string; content: string; heading?: string }) {
  const text = content.replace(/\n$/, "");
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {heading ? <h3 className="text-sm font-semibold text-primary">{heading}</h3> : null}
        <code className="text-xs text-ink-faint">{name}</code>
        <span className="ml-auto flex gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={`Copy ${name}`}
            onClick={() => {
              navigator.clipboard?.writeText(content).then(
                () => toast.success("Copied"),
                () => toast.error("Could not copy: select the text and press Ctrl/Cmd+C")
              );
            }}
          >
            <Copy aria-hidden /> Copy
          </Button>
          <Button type="button" size="xs" variant="ghost" aria-label={`Download ${name}`} onClick={() => saveBlob(new Blob([content], { type: "text/x-python;charset=utf-8" }), name)}>
            <Download aria-hidden /> Download
          </Button>
        </span>
      </div>
      <CodeBlock className="max-h-[28rem] whitespace-pre">{text}</CodeBlock>
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex items-center gap-1 rounded text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none")}
      >
        {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
        {label}
      </button>
      {open ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
