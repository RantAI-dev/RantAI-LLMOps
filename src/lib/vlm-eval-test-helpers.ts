/** Test helpers only: a tiny VLM test-set ZIP built in memory. Not imported by the app. */
import { zipSync } from "fflate";

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

/** One eval row in the dataset format of docs §3.1: image + prompt, then the key. */
export const evalRow = (image: string, prompt: string, gold: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    messages: [
      { role: "user", content: [{ type: "image", image }, { type: "text", text: prompt }] },
      { role: "assistant", content: [{ type: "text", text: gold }] },
    ],
    ...extra,
  });

/** `n` rows whose key is `k<i>`, each with its own PNG; extra files and rows can be added. */
export function makeZip(opts: {
  n?: number;
  prefix?: string;
  rows?: string[];
  files?: Record<string, Uint8Array>;
  noTrain?: boolean;
} = {}): Uint8Array {
  const n = opts.n ?? 6;
  const prefix = opts.prefix ?? "";
  const files: Record<string, Uint8Array> = {};
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    files[`${prefix}images/img${i}.png`] = new Uint8Array([...PNG, i]);
    rows.push(evalRow(`images/img${i}.png`, `What is in image ${i}?`, `k${i}`));
  }
  for (const r of opts.rows ?? []) rows.push(r);
  if (!opts.noTrain) files[`${prefix}train.jsonl`] = new TextEncoder().encode(rows.join("\n") + "\n");
  for (const [k, v] of Object.entries(opts.files ?? {})) files[k] = v;
  return zipSync(files);
}
