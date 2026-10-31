"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { DecisionReview, TextReview } from "@/modules/datasets/lib/review";

const FORMAT_LABEL = { jsonl: "JSONL", csv: "CSV", json: "JSON array", pairs: "prompt | completion lines" } as const;

/** What a text dataset will look like once saved: format, columns, the layout training will use, a few rows. */
export function TextReviewView({ review }: { review: TextReview }) {
  const { report, blocked } = review;
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink">{FORMAT_LABEL[report.format]}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">
          {report.partial ? `${report.rows.toLocaleString()}+ rows in the first MB` : `${report.rows.toLocaleString()} rows`}
        </span>
        {report.rows > 0 ? (
          <span
            className={
              report.schema.recognised
                ? "inline-flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 font-medium text-success"
                : "inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning"
            }
          >
            {report.schema.recognised ? <CheckCircle2 className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
            {report.schema.label}
          </span>
        ) : null}
      </div>
      {blocked ? (
        <p role="alert" className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[12px] leading-4 text-danger">
          {blocked}
        </p>
      ) : null}
      {!blocked && !report.schema.recognised && report.rows > 0 ? (
        <p className="text-[11px] leading-4 text-warning">
          These columns are not a known layout, so training will join all of them into one text. Name them{" "}
          <code>prompt</code> and <code>completion</code> (or <code>instruction</code> and <code>output</code>) for a clean format.
        </p>
      ) : null}
      {report.sample.length > 0 ? (
        <div className="max-h-48 overflow-auto rounded-md border border-border">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface-2 text-ink-soft">
              <tr>
                {report.columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.sample.map((row, i) => (
                <tr key={i} className="border-t border-border align-top">
                  {report.columns.map((c) => (
                    <td key={c} className="max-w-[16rem] break-words px-2 py-1 text-ink">
                      {row[c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** What the decision-row validator found: counts, the first problems, the labels per question, an example row. */
export function DecisionReviewView({ review, label }: { review: DecisionReview; label: string }) {
  const { report, blocked, example, partial } = review;
  return (
    <div
      aria-live="polite"
      className={
        blocked
          ? "rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[11px] leading-4"
          : "rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-4"
      }
    >
      <p className={blocked ? "font-medium text-danger" : "font-medium text-ink"}>
        {label}: {report.valid.toLocaleString()} valid of {report.total.toLocaleString()} rows{partial ? " in the first MB" : ""}
        {report.invalid ? ` · ${report.invalid} invalid` : ""}
      </p>
      {blocked ? (
        <p role="alert" className="mt-1 text-danger">
          {blocked}
        </p>
      ) : null}
      {!blocked && report.errors.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-ink-soft">
          {report.errors.slice(0, 3).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {!blocked
        ? Object.entries(report.questions).map(([qName, q]) => (
            <p key={qName} className="mt-1 text-ink-soft">
              <span className="font-medium text-ink">{qName}</span> ({q.type}, {q.rows} labelled):{" "}
              {Object.entries(q.labels)
                .map(([l, n]) => `${l} ${n}`)
                .join(" · ")}
            </p>
          ))
        : null}
      {!blocked && example ? (
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-1.5 font-mono text-[10px] leading-4 text-ink-soft">
          {example}
        </pre>
      ) : null}
    </div>
  );
}
