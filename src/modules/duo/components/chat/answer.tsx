"use client";

import "./answer.css";

import { memo, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { esc, markdown } from "@/modules/duo/vendor/nafs-render.js";

// ---------------------------------------------------------------------------------------------------------------
// Charts: the renderer turns a ```chart block into a figure with its spec in data-chart and the data as a table.
// The original app draws it with Nivo (700 KB); here a small SVG covers bar, line, area and pie, and any other kind
// keeps the data table open (nothing is lost).
// ---------------------------------------------------------------------------------------------------------------

const PALETTE = ["#0F8F94", "#7C5CC4", "#D58A12", "#2F9E55", "#D6455D", "#3B82F6", "#C2549A", "#7B8794"];
type Spec = {
  type?: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  unit?: string;
  data?: Array<Record<string, unknown>>;
  keys?: string[];
  indexBy?: string;
  horizontal?: boolean;
  stacked?: boolean;
  series?: Array<{ id: string; data: Array<{ x: unknown; y: number }> }>;
  donut?: boolean;
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const short = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${+v.toFixed(2)}`);

function legend(names: string[], y: number) {
  return names
    .map((k, i) => `<g transform="translate(${12 + (i % 4) * 140},${y + Math.floor(i / 4) * 16})"><rect width="10" height="10" rx="2" fill="${PALETTE[i % PALETTE.length]}"/><text x="14" y="9" class="duo-chart-tx">${esc(k.slice(0, 18))}</text></g>`)
    .join("");
}

/** SVG markup for a spec, or null when this kind is not drawn here. */
export function chartSvg(spec: Spec): string | null {
  const W = 560;
  const H = 260;
  const pad = { l: 48, r: 12, t: 12, b: 36 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  if (spec.type === "pie" && Array.isArray(spec.data)) {
    const pts = spec.data.map((d) => ({ label: String(d.label ?? d.id ?? ""), value: n(d.value) })).filter((d) => d.value > 0);
    const total = pts.reduce((s, p) => s + p.value, 0);
    if (!total) return null;
    const cx = 130;
    const cy = 120;
    const r = 100;
    const inner = spec.donut ? 55 : 0;
    let a0 = -Math.PI / 2;
    const slices = pts
      .map((p, i) => {
        const a1 = a0 + (p.value / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0, x1, y1] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
        const path =
          pts.length === 1
            ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
            : `M${cx},${cy}L${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}Z`;
        a0 = a1;
        return `<path d="${path}" fill="${PALETTE[i % PALETTE.length]}" stroke="var(--background)" stroke-width="2"><title>${esc(p.label)}: ${esc(short(p.value))} (${((p.value / total) * 100).toFixed(1)}%)</title></path>`;
      })
      .join("");
    const hole = inner ? `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="var(--background)"/>` : "";
    const lg = pts
      .slice(0, 12)
      .map((p, i) => `<g transform="translate(260,${24 + i * 18})"><rect width="10" height="10" rx="2" fill="${PALETTE[i % PALETTE.length]}"/><text x="16" y="9" class="duo-chart-tx">${esc(p.label.slice(0, 28))} · ${((p.value / total) * 100).toFixed(1)}%</text></g>`)
      .join("");
    return `<svg viewBox="0 0 ${W} ${Math.max(H, 40 + pts.length * 18)}" class="duo-chart" role="img">${slices}${hole}${lg}</svg>`;
  }
  if (spec.type === "bar" && Array.isArray(spec.data) && Array.isArray(spec.keys) && spec.indexBy) {
    const keys = spec.keys;
    const rows = spec.data.slice(0, 40);
    const totals = rows.map((r) => (spec.stacked ? keys.reduce((s, k) => s + Math.max(0, n(r[k])), 0) : Math.max(...keys.map((k) => n(r[k])))));
    const max = Math.max(1e-9, ...totals);
    const min = Math.min(0, ...rows.flatMap((r) => keys.map((k) => n(r[k]))));
    const span = max - min || 1;
    const band = iw / Math.max(1, rows.length);
    const bw = spec.stacked ? band * 0.7 : (band * 0.8) / keys.length;
    const y = (v: number) => pad.t + ih - ((v - min) / span) * ih;
    const bars = rows
      .map((r, i) => {
        let acc = 0;
        return keys
          .map((k, j) => {
            const v = n(r[k]);
            const x = pad.l + i * band + (spec.stacked ? band * 0.15 : band * 0.1 + j * bw);
            const top = spec.stacked ? y(acc + Math.max(0, v)) : y(Math.max(0, v));
            const bottom = spec.stacked ? y(acc) : y(Math.min(0, v));
            if (spec.stacked) acc += Math.max(0, v);
            return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.max(0.5, bottom - top).toFixed(1)}" rx="2" fill="${PALETTE[j % PALETTE.length]}"><title>${esc(String(r[spec.indexBy!]))} · ${esc(k)}: ${esc(short(v))}${esc(spec.unit ?? "")}</title></rect>`;
          })
          .join("");
      })
      .join("");
    const labels = rows
      .map((r, i) => (rows.length <= 16 || i % Math.ceil(rows.length / 16) === 0 ? `<text x="${(pad.l + i * band + band / 2).toFixed(1)}" y="${H - pad.b + 14}" text-anchor="middle" class="duo-chart-tx">${esc(String(r[spec.indexBy!] ?? "").slice(0, 10))}</text>` : ""))
      .join("");
    const ticks = [0, 0.25, 0.5, 0.75, 1]
      .map((t) => {
        const v = min + span * t;
        return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="duo-chart-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="duo-chart-tx">${esc(short(v))}</text>`;
      })
      .join("");
    const lg = keys.length > 1 ? legend(keys, H + 4) : "";
    return `<svg viewBox="0 0 ${W} ${H + (keys.length > 1 ? 10 + Math.ceil(keys.length / 4) * 16 : 0)}" class="duo-chart" role="img">${ticks}${bars}${labels}${lg}</svg>`;
  }
  if ((spec.type === "line" || spec.type === "area") && Array.isArray(spec.series) && spec.series.length) {
    const series = spec.series.slice(0, 8);
    const xs = [...new Set(series.flatMap((s) => s.data.map((p) => String(p.x))))];
    const numeric = series.every((s) => s.data.every((p) => typeof p.x === "number"));
    const xsNum = numeric ? series.flatMap((s) => s.data.map((p) => p.x as number)) : [];
    const [xmin, xmax] = numeric ? [Math.min(...xsNum), Math.max(...xsNum)] : [0, Math.max(1, xs.length - 1)];
    const ys = series.flatMap((s) => s.data.map((p) => n(p.y)));
    const ymin = Math.min(0, ...ys);
    const ymax = Math.max(1e-9, ...ys);
    const X = (p: { x: unknown }) => pad.l + (((numeric ? (p.x as number) : xs.indexOf(String(p.x))) - xmin) / (xmax - xmin || 1)) * iw;
    const Y = (v: number) => pad.t + ih - ((v - ymin) / (ymax - ymin || 1)) * ih;
    const paths = series
      .map((s, i) => {
        const pts = s.data.map((p) => `${X(p).toFixed(1)},${Y(n(p.y)).toFixed(1)}`);
        const c = PALETTE[i % PALETTE.length];
        const area = spec.type === "area" && pts.length ? `<path d="M${pts[0].split(",")[0]},${Y(ymin)}L${pts.join("L")}L${pts[pts.length - 1].split(",")[0]},${Y(ymin)}Z" fill="${c}" opacity=".18"/>` : "";
        const dots = s.data.length <= 40 ? s.data.map((p) => `<circle cx="${X(p).toFixed(1)}" cy="${Y(n(p.y)).toFixed(1)}" r="2.6" fill="${c}"><title>${esc(s.id)} · ${esc(String(p.x))}: ${esc(short(n(p.y)))}</title></circle>`).join("") : "";
        return `${area}<polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="2"/>${dots}`;
      })
      .join("");
    const ticks = [0, 0.5, 1]
      .map((t) => {
        const v = ymin + (ymax - ymin) * t;
        return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="duo-chart-grid"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="duo-chart-tx">${esc(short(v))}</text>`;
      })
      .join("");
    const xl = numeric
      ? [xmin, (xmin + xmax) / 2, xmax].map((v) => `<text x="${(pad.l + ((v - xmin) / (xmax - xmin || 1)) * iw).toFixed(1)}" y="${H - pad.b + 14}" text-anchor="middle" class="duo-chart-tx">${esc(short(v))}</text>`).join("")
      : xs.map((x, i) => (xs.length <= 12 || i % Math.ceil(xs.length / 12) === 0 ? `<text x="${(pad.l + (i / Math.max(1, xs.length - 1)) * iw).toFixed(1)}" y="${H - pad.b + 14}" text-anchor="middle" class="duo-chart-tx">${esc(x.slice(0, 10))}</text>` : "")).join("");
    const lg = series.length > 1 ? legend(series.map((s) => s.id), H + 4) : "";
    return `<svg viewBox="0 0 ${W} ${H + (series.length > 1 ? 10 + Math.ceil(series.length / 4) * 16 : 0)}" class="duo-chart" role="img">${ticks}${paths}${xl}${lg}</svg>`;
  }
  return null;
}

/** Draw every chart figure inside `root` that has not been drawn yet. */
function hydrateCharts(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("figure.nvchart:not([data-drawn])").forEach((fig) => {
    fig.setAttribute("data-drawn", "1");
    const mount = fig.querySelector<HTMLElement>(".chart-mount");
    const wait = fig.querySelector<HTMLElement>(".chart-wait");
    let svg: string | null = null;
    try {
      svg = chartSvg(JSON.parse(fig.getAttribute("data-chart") ?? "{}") as Spec);
    } catch {
      svg = null;
    }
    if (wait) wait.remove();
    if (svg && mount) mount.innerHTML = svg;
    else {
      const details = fig.querySelector<HTMLDetailsElement>("details.chart-data");
      if (details) details.open = true;
      if (mount) mount.innerHTML = `<p class="duo-chart-note">This kind of chart is shown as its data below.</p>`;
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Buttons the renderer writes (data-act): copy and save tables, code, figures.
// ---------------------------------------------------------------------------------------------------------------

function tableRows(table: HTMLTableElement) {
  return [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").trim()));
}
const csvOf = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
const mdOf = (rows: string[][]) =>
  rows.length ? [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`).join("\n") : "";

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Copying is blocked in this browser");
  }
}

function onAction(e: React.MouseEvent<HTMLDivElement>) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act], button.copy");
  if (!btn) return;
  const act = btn.dataset.act ?? (btn.classList.contains("copy") ? "copycode" : "");
  const pre = btn.closest("pre");
  const fig = btn.closest("figure");
  const wrap = btn.closest(".tablewrap");
  const table = wrap?.querySelector("table") ?? null;
  switch (act) {
    case "copycode":
      if (pre) void copy(pre.querySelector("code")?.textContent ?? "", "Code");
      break;
    case "wrap":
      if (pre) {
        pre.classList.toggle("wrapped");
        btn.setAttribute("aria-pressed", String(pre.classList.contains("wrapped")));
      }
      break;
    case "savecode":
      if (pre) {
        const lang = (pre.querySelector(".lang")?.textContent ?? "txt").trim().toLowerCase();
        const ext = { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", json: "json", bash: "sh", sh: "sh", sql: "sql", rust: "rs", go: "go", html: "html", css: "css", latex: "tex", tex: "tex" }[lang] ?? "txt";
        download(pre.querySelector("code")?.textContent ?? "", `code.${ext}`, "text/plain");
      }
      break;
    case "table":
      if (table) void copy(tableRows(table).map((r) => r.join("\t")).join("\n"), "Table");
      break;
    case "tablemd":
      if (table) void copy(mdOf(tableRows(table)), "Table");
      break;
    case "tablecsv":
      if (table) download(csvOf(tableRows(table)), "table.csv", "text/csv");
      break;
    case "source":
      if (fig) {
        const src = fig.querySelector<HTMLElement>(".fig-source");
        if (src) src.hidden = !src.hidden;
      }
      break;
    case "copysrc":
      if (fig) void copy(fig.querySelector(".fig-source code")?.textContent ?? "", "Source");
      break;
    case "csv":
      if (fig) {
        const t = fig.querySelector("table");
        if (t) download(csvOf(tableRows(t)), "chart.csv", "text/csv");
      }
      break;
    case "svg":
      if (fig) {
        const svg = fig.querySelector("svg");
        if (svg) download(new XMLSerializer().serializeToString(svg), "figure.svg", "image/svg+xml");
        else toast.info("This figure has no drawing to save; save its data instead");
      }
      break;
    case "full":
    case "expand":
      if (fig) fig.classList.toggle("fig-full");
      break;
    case "tex": {
      const m = btn.closest(".math");
      const tex = m?.getAttribute("data-tex") ?? m?.querySelector("annotation")?.textContent ?? "";
      if (tex) void copy(tex, "LaTeX");
      break;
    }
    case "png":
      toast.info("Save as SVG, or take a screenshot: PNG export is not available here");
      break;
    default:
      return;
  }
  e.preventDefault();
}

/**
 * An answer as the original Nafs-Aql app draws it: Markdown, tables, maths (MathML), Mermaid diagrams and charts.
 * The renderer escapes everything the model wrote, so its HTML is safe to insert. `cites` turns [n] into source
 * buttons; `onCite` is called with the number.
 */
export const Answer = memo(function Answer({
  text,
  streaming = false,
  cites,
  onCite,
  className,
}: {
  text: string;
  streaming?: boolean;
  cites?: number[];
  onCite?: (n: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const citeKey = cites?.join(",") ?? "";
  const html = useMemo(() => {
    try {
      return markdown(text, citeKey ? new Set(citeKey.split(",").map(Number)) : null);
    } catch {
      return `<p>${esc(text)}</p>`;
    }
  }, [text, citeKey]);
  useEffect(() => {
    if (ref.current && !streaming) hydrateCharts(ref.current);
  }, [html, streaming]);
  return (
    <div
      ref={ref}
      className={["duo-answer", className].filter(Boolean).join(" ")}
      onClick={(e) => {
        const c = (e.target as HTMLElement).closest<HTMLButtonElement>("button.cite[data-cite]");
        if (c && onCite) {
          onCite(Number(c.dataset.cite));
          e.preventDefault();
          return;
        }
        onAction(e);
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming ? <span className="caret" aria-hidden /> : null}
    </div>
  );
});
