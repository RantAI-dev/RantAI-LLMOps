"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { DecisionReview, TextReview, VisionReview } from "@/modules/datasets/lib/review";

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

const formatBytes = (n: number): string =>
  n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const Chip = ({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "ok" | "warn" | "bad" }) => (
  <span
    className={
      tone === "ok"
        ? "inline-flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 font-medium text-success"
        : tone === "warn"
          ? "inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning"
          : tone === "bad"
            ? "inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-0.5 font-medium text-danger"
            : "rounded bg-surface-2 px-1.5 py-0.5 text-ink"
    }
  >
    {children}
  </span>
);

/**
 * What an image dataset (a ZIP) will look like once saved: rows and images found, what is missing or unused,
 * the size, and the first rows with their pictures. `thumbs` maps an image path to a `data:` URL (the page's
 * CSP allows `data:` images, not `blob:`).
 */
export function VisionReviewView({ review, thumbs }: { review: VisionReview; thumbs: Record<string, string> }) {
  const { train, eval: evalReport, blocked } = review;
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {train ? (
          <Chip tone={blocked ? "bad" : "ok"}>
            {blocked ? <AlertTriangle className="size-3" aria-hidden /> : <CheckCircle2 className="size-3" aria-hidden />}
            {train.valid.toLocaleString()} of {train.total.toLocaleString()} train rows valid
          </Chip>
        ) : null}
        {evalReport ? <Chip>{evalReport.valid.toLocaleString()} eval rows</Chip> : null}
        <Chip>{review.imageCount.toLocaleString()} images</Chip>
        <Chip>{formatBytes(review.zipBytes)}</Chip>
        {review.missing.length > 0 ? <Chip tone="bad">{review.missing.length.toLocaleString()} missing images</Chip> : null}
        {review.unused.length > 0 ? <Chip tone="warn">{review.unused.length.toLocaleString()} unused images</Chip> : null}
      </div>
      {blocked ? (
        <p role="alert" className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[12px] leading-4 text-danger">
          {blocked}
        </p>
      ) : null}
      {train && train.problems.length > 0 ? (
        <ul className="list-disc pl-4 text-[11px] leading-4 text-ink-soft">
          {train.problems.slice(0, 3).map((p) => (
            <li key={`${p.line}-${p.why}`}>
              train.jsonl line {p.line}: {p.why}
            </li>
          ))}
        </ul>
      ) : null}
      {!blocked && review.unused.length > 0 ? (
        <p className="text-[11px] leading-4 text-ink-soft">
          {review.unused.length.toLocaleString()} image{review.unused.length === 1 ? " is" : "s are"} not used by any row (for example{" "}
          <code>{review.unused[0]}</code>). They are saved anyway.
        </p>
      ) : null}
      {review.rejected.length > 0 ? (
        <p className="text-[11px] leading-4 text-warning">
          {review.rejected.length} file{review.rejected.length === 1 ? "" : "s"} under images/ will be left out (only .jpg, .jpeg, .png and .webp are
          accepted), for example <code>{review.rejected[0]}</code>.
        </p>
      ) : null}
      {review.sample.length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-md border border-border">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface-2 text-ink-soft">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Image</th>
                <th className="px-2 py-1 text-left font-medium">Question</th>
                <th className="px-2 py-1 text-left font-medium">Answer</th>
              </tr>
            </thead>
            <tbody>
              {review.sample.map((row, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-2 py-1">
                    <div className="flex max-w-[14rem] flex-wrap gap-1">
                      {row.images.length === 0 ? <span className="text-ink-soft">no image</span> : null}
                      {row.images.map((path, k) =>
                        thumbs[path.replace(/^(\.\/)+/, "")] ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a data: URL of a few KB; next/image would need a loader for it
                          <img
                            key={k}
                            src={thumbs[path.replace(/^(\.\/)+/, "")]}
                            alt={path}
                            className="max-h-14 max-w-[13rem] rounded border border-border bg-white object-contain"
                          />
                        ) : (
                          <code key={k} className="break-all text-[10px] text-ink-soft">
                            {path}
                          </code>
                        )
                      )}
                    </div>
                  </td>
                  <td className="max-w-[12rem] break-words px-2 py-1 text-ink">{row.user}</td>
                  <td className="max-w-[12rem] break-words px-2 py-1 text-ink">{row.assistant}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
