/**
 * Pull the HF Trainer's per-step `'loss': X` values out of a raw training log
 * (the Unsloth/HF trainer stdout captured in provider_logs). Shared by the live
 * training monitor and the run comparison view.
 */
export function parseLoss(text: string): number[] {
  const out: number[] = [];
  // Match the training-loss key `'loss': X` only. `['"]loss['"]` needs a quote
  // immediately around `loss`, so it never matches `'eval_loss'` (the char before
  // `loss` there is `_`) — the two series stay cleanly separated.
  const re = /['"]loss['"]\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Pull the HF Trainer's `'eval_loss': X` values (logged when an eval_dataset /
 * validation split is present) out of the same raw log. Charted alongside the
 * training loss so a user can watch train vs eval converge or diverge.
 */
export function parseEvalLoss(text: string): number[] {
  const out: number[] = [];
  const re = /['"]eval_loss['"]\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}
