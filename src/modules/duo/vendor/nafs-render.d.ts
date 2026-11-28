/** Types for the vendored Nafs-Aql answer renderer (nafs-render.js): pure string-to-HTML, every model text escaped. */
export function esc(s: unknown): string;
/** Markdown (tables, task lists, callouts, footnotes), LaTeX as MathML, Mermaid as SVG, ```chart blocks as figures. */
export function markdown(src: string, cites?: Set<number> | null): string;
export function mathml(tex: string, display?: boolean): string;
export function highlight(code: string, lang?: string): string;
export function mermaid(src: string): string;
export function chartSpec(src: string): Record<string, unknown> & { error?: string };
export function answerPlain(src: string): string;
