"use client";

import { AlertTriangle, BookOpen, CheckCircle2, FileStack, Hash, ScanEye } from "lucide-react";

import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import type { Chapter, TriageReport } from "@/lib/pdf-corpus";
import { pageRange } from "@/modules/corpus/lib/format";
import type { CorpusProcessResult } from "@/modules/corpus/types";
import { textUi } from "@/lib/text-ui";
import { cn } from "@/lib/utils";

/**
 * What the pre-processing actually did — the triage verdict, the chapter map it
 * inferred, and a chunk sample. This is the manual quality gate the plan asks
 * for (langkah 1.6): the chapter map is a GUESS from typography or a running
 * header, and a wrong guess poisons every citation in the book, so it is shown
 * before anything is written rather than buried in a log.
 */
export function CorpusReport({ result }: { result: CorpusProcessResult }) {
  const { catalog, triage, preview } = result;
  const { stats } = catalog;

  const cards: SummaryCard[] = [
    {
      label: "Pages",
      value: String(catalog.pageCount),
      sub: `${triage.digitalPages} with a text layer`,
      icon: FileStack,
      iconWrapClassName: "bg-primary-soft",
      iconClassName: "text-primary",
    },
    {
      label: "Chapters",
      value: String(catalog.chapters.length),
      sub: stats.untitledChapters ? `${stats.untitledChapters} without a title` : "all titled",
      icon: BookOpen,
      iconWrapClassName: "bg-warning-soft",
      iconClassName: "text-warning-gold",
    },
    {
      label: "Chunks",
      value: String(stats.chunkCount),
      sub: `${stats.totalTokens.toLocaleString()} tokens total`,
      icon: Hash,
      iconWrapClassName: "bg-success-soft",
      iconClassName: "text-success",
    },
    {
      label: "Avg tokens/chunk",
      value: String(stats.averageTokens),
      sub: `target ${catalog.chunkOptions.targetTokens} · ${catalog.chunkOptions.overlapPercent}% overlap`,
      icon: ScanEye,
      iconWrapClassName: "bg-surface-2",
      iconClassName: "text-ink-soft",
    },
  ];

  return (
    <div className="space-y-4">
      <SummaryCardGrid
        cards={cards}
        columns={4}
        cardClassName="border-hairline shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
        titleClassName="text-sm font-medium text-primary"
        contentClassName="space-y-1"
        metricClassName={textUi.metric}
      />

      <TriagePanel triage={triage} />

      <section className="rounded-lg border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={`${textUi.section} text-primary`}>Chapter map</h3>
          <ChapterSourceNote source={catalog.chapters[0]?.source} />
        </div>
        <p className="mt-1 text-[12px] text-ink-soft">
          Each chunk is stamped with its chapter. Check these before saving — a wrong chapter here
          becomes a wrong citation in every answer the model grounds on this book.
        </p>
        <ul className="mt-3 divide-y divide-hairline">
          {catalog.chapters.map((chapter) => (
            <li key={chapter.index} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="font-mono text-[11px] text-ink-faint">
                {pageRange(chapter.startPage, chapter.endPage)}
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-ink">
                {chapter.label || <span className="text-ink-soft">(whole book — no chapters found)</span>}
              </span>
              {!chapter.title ? (
                <span className="text-[11px] text-warning">title not read</span>
              ) : null}
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-hairline pt-3 text-[12px] text-ink-soft">
          <Stat label="Front matter dropped" value={`${stats.frontMatterPages} pages`} />
          <Stat label="Running lines removed" value={String(stats.runningLinesRemoved)} />
          <Stat label="Knowledge base" value={catalog.knowledgeBase} />
          <Stat label="Checksum" value={catalog.checksum.slice(0, 12)} />
        </dl>
      </section>

      <section className="rounded-lg border border-hairline bg-surface p-4">
        <h3 className={`${textUi.section} text-primary`}>
          Chunk sample{" "}
          <span className="text-[12px] font-normal text-ink-soft">
            (first {preview.length} of {stats.chunkCount})
          </span>
        </h3>
        <div className="mt-3 space-y-3">
          {preview.map((chunk) => (
            <article key={chunk.id} className="rounded-md border border-hairline bg-surface-2 p-3">
              <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                <span className="font-mono">{chunk.id}</span>
                <span>{pageRange(chunk.pageStart, chunk.pageEnd)}</span>
                <span>~{chunk.tokens} tokens</span>
              </header>
              <p className="mb-1 font-mono text-[11px] break-words text-primary">{chunk.citation}</p>
              <p className="text-[12px] leading-5 whitespace-pre-wrap text-ink-soft">
                {chunk.text.slice(chunk.citation.length).trim().slice(0, 600)}
                {chunk.text.length - chunk.citation.length > 600 ? "…" : ""}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-hairline bg-surface p-4">
        <h3 className={`${textUi.section} text-primary`}>
          {result.saved ? "Written to" : "Will be written to"}
        </h3>
        <ul className="mt-2 space-y-1 font-mono text-[11px] break-all text-ink-soft">
          {(["raw", "processed", "chunks", "catalog"] as const).map((stage) => (
            <li key={stage}>
              <span className="inline-block w-20 text-ink-faint">{stage}</span>
              {result.saved ? result.saved[stage] : result.keys[stage]}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The format triage (langkah 1.2) — the number that sizes the OCR queue. */
function TriagePanel({ triage }: { triage: TriageReport }) {
  const tone =
    triage.verdict === "digital"
      ? { icon: CheckCircle2, className: "border-success/40 bg-success-soft text-success" }
      : triage.verdict === "mixed"
        ? { icon: ScanEye, className: "border-warning/40 bg-warning-soft text-warning" }
        : { icon: AlertTriangle, className: "border-danger-border bg-danger-soft text-danger" };
  const Icon = tone.icon;

  const message =
    triage.verdict === "digital"
      ? "Clean digital text — extracted directly, no OCR needed."
      : triage.verdict === "mixed"
        ? `${triage.ocrPages} of ${triage.totalPages} pages have almost no extractable text (usually scanned plates or full-page images). Their content is missing from the chunks below.`
        : `Only ${triage.digitalPages} of ${triage.totalPages} pages have a usable text layer. This book is a scan — it belongs in the OCR/VL pipeline, not here. Saving it now would store mostly empty chunks.`;

  return (
    <div className={cn("flex gap-3 rounded-lg border p-3", tone.className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-medium">
          Format triage: {triage.verdict} ({Math.round(triage.ocrRatio * 100)}% of pages need OCR)
        </p>
        <p className="mt-0.5 text-[12px] opacity-90">{message}</p>
      </div>
    </div>
  );
}

/** How the chapters were found — honesty about the confidence behind them. */
function ChapterSourceNote({ source }: { source: Chapter["source"] | undefined }) {
  const notes: Record<Chapter["source"], string> = {
    outline: "from the PDF's own bookmarks",
    heading: "inferred from heading typography",
    "running-header": "inferred from the running header",
    fallback: "no chapters found — treated as one section",
  };
  if (!source) return null;
  return <span className="text-[11px] text-ink-faint">{notes[source]}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-faint">{label}:</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
