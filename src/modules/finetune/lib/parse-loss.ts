/**
 * Pull the HF Trainer's per-step `'loss': X` values out of a raw training log
 * (the Unsloth/HF trainer stdout captured in provider_logs). Shared by the live
 * training monitor and the run comparison view.
 */
export function parseLoss(text: string): number[] {
  const out: number[] = [];
  const re = /['"]loss['"]\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}
