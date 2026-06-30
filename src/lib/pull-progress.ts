"use client";

/**
 * POST a model ref to `/api/models/download` and consume the SSE progress stream,
 * calling `onProgress(percent, status)` as it goes. Resolves when the pull
 * finishes; rejects with the server-reported error.
 *
 * `model` is anything Ollama can pull — an Ollama tag (`qwen2.5:1.5b`) or a
 * Hugging Face GGUF repo (`hf.co/{owner}/{repo}:{quant}`).
 */
export async function pullModelWithProgress(
  model: string,
  onProgress: (percent: number | null, status: string) => void
): Promise<void> {
  const res = await fetch("/api/models/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Download failed (${res.status})`);
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
      let evt: { percent?: number | null; status?: string; done?: boolean; error?: string };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.error) throw new Error(evt.error);
      if (evt.done) return;
      onProgress(evt.percent ?? null, evt.status ?? "");
    }
  }
}
