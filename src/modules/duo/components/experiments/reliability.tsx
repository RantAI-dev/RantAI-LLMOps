"use client";

import { arr, fmtNum, rec } from "@/modules/duo/components/duo-ui";

export type ReliabilityPoint = { predicted: number; observed: number; count: number };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Reliability points from any of the gateway's shapes: `{predicted, observed, count}` (eval runs), `[p, o, n]` tuples,
 * or the calibration's risk bins `{lo, hi, n, errors}`.
 */
export function toReliability(v: unknown): ReliabilityPoint[] {
  return arr<unknown>(v).flatMap((x) => {
    if (Array.isArray(x)) {
      const [p, o, c] = x.map(n);
      return p !== null && o !== null ? [{ predicted: p, observed: o, count: c ?? 0 }] : [];
    }
    const r = rec(x);
    const p = n(r.predicted);
    const o = n(r.observed);
    if (p !== null && o !== null) return [{ predicted: p, observed: o, count: n(r.count) ?? 0 }];
    const lo = n(r.lo);
    const hi = n(r.hi);
    const cnt = n(r.n);
    const err = n(r.errors);
    if (lo !== null && hi !== null && cnt && err !== null) return [{ predicted: (lo + hi) / 2, observed: err / cnt, count: cnt }];
    return [];
  });
}

const W = 300;
const H = 260;
const P = 36;

/** Predicted chance that the quick answer is wrong (x) against how often it was (y). On the diagonal is perfect. */
export function Reliability({ points }: { points: ReliabilityPoint[] }) {
  const sx = (v: number) => P + Math.max(0, Math.min(1, v)) * (W - P - 10);
  const sy = (v: number) => H - P - Math.max(0, Math.min(1, v)) * (H - P - 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Predicted against observed mistakes of System 1" className="mx-auto w-full max-w-[320px]">
      <rect x={P} y={10} width={W - P - 10} height={H - P - 10} fill="none" className="stroke-hairline" />
      <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} className="stroke-ink-faint" strokeDasharray="4 3" />
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <text x={sx(t)} y={H - P + 14} textAnchor="middle" className="fill-ink-soft text-[10px]">
            {t}
          </text>
          <text x={P - 5} y={sy(t) + 3} textAnchor="end" className="fill-ink-soft text-[10px]">
            {t}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.predicted)} cy={sy(p.observed)} r={3 + Math.min(8, Math.sqrt(p.count))} className="fill-primary" fillOpacity={0.6}>
          <title>{`predicted ${fmtNum(p.predicted, 2)} · observed ${fmtNum(p.observed, 2)} · ${p.count} answers`}</title>
        </circle>
      ))}
      <text x={(W + P) / 2} y={H - 4} textAnchor="middle" className="fill-ink-soft text-[10px]">
        Predicted chance the quick answer is wrong
      </text>
      <text x={10} y={H / 2} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle" className="fill-ink-soft text-[10px]">
        Observed
      </text>
    </svg>
  );
}
