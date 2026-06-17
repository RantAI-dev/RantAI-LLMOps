import { Fragment, type ReactNode } from "react";

/**
 * Minimal, dependency-free, XSS-safe markdown preview — renders to React
 * elements (never dangerouslySetInnerHTML). Supports headings (#/##/###),
 * fenced ``` code blocks, -/* bullet lists, blank-line paragraphs, and inline
 * **bold** + `code`. Enough for lab notes; swap for react-markdown later if
 * full GFM (links, images, tables) is needed.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code
          key={key}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary-strong"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function MarkdownPreview({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let bk = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={`b${bk++}`}
          className="overflow-x-auto rounded-md bg-[#1a1a1a] p-3 font-mono text-[12px] leading-5 text-[#e4e4e7]"
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? "text-lg font-semibold text-ink"
          : level === 2
            ? "text-base font-semibold text-ink"
            : "text-[14px] font-semibold text-ink";
      blocks.push(
        <p key={`b${bk++}`} className={`mt-3 first:mt-0 ${cls}`}>
          {renderInline(heading[2], `h${bk}`)}
        </p>
      );
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`b${bk++}`} className="ml-4 list-disc space-y-1 text-ink-soft">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li${bk}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`b${bk++}`} className="text-ink-soft">
        {renderInline(para.join(" "), `p${bk}`)}
      </p>
    );
  }

  if (blocks.length === 0) {
    return <p className="text-[14px] text-ink-faint italic">Nothing to preview yet.</p>;
  }

  return <div className="space-y-2 text-[14px] leading-6">{blocks}</div>;
}
