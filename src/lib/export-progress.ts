"use client";

/**
 * POST a fine-tune's train-job id to `/api/finetune/export` and consume the SSE
 * stage stream, calling `onStage(message, percent)` as the export progresses
 * (merge → convert → import). Resolves with the new Ollama tag when done (or, for a vision-language model,
 * an empty tag plus the two llama.cpp files in `vl`); rejects with the server-reported error.
 */
export type ExportOutcome = { tag: string; vl?: { gguf: string; mmproj: string; command: string } };

export async function exportModelWithProgress(
  fusedModelId: string,
  onStage: (message: string, percent: number | null) => void,
  outtype?: "q8_0" | "f16" | "bf16" | "q4_k_m" | "q5_k_m"
): Promise<ExportOutcome> {
  const res = await fetch("/api/finetune/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(outtype ? { fusedModelId, outtype } : { fusedModelId }),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Export failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload) continue;
      let evt: { stage?: string; percent?: number | null; done?: boolean; tag?: string; error?: string; vl?: ExportOutcome["vl"] };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.error) throw new Error(evt.error);
      if (evt.done) return { tag: evt.tag ?? "", ...(evt.vl ? { vl: evt.vl } : {}) };
      if (evt.stage) onStage(evt.stage, evt.percent ?? null);
    }
  }
  return { tag: "" };
}
