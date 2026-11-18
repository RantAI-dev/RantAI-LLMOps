import { runHostScript } from "@/lib/host-runner";

/** A trained (unmerged) LoRA adapter on disk: its job, its directory, and the base it was trained on. */
export type TrainedAdapter = { jobId: string; path: string; base: string };

// List trained (unmerged) adapters on disk via the backend host-runner. Best
// effort: if the runner isn't wired for this deployment, the UI just falls back
// to the manual "attach by path" form. Reuses the locator the serve scripts use.
const LIST_CMD =
  `find "$HOME/.transformerlab/orgs" -path '*jobs/*/models/*' -name adapter_config.json 2>/dev/null ` +
  `| while IFS= read -r f; do ` +
  `b=$(sed -n 's/.*"base_model_name_or_path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$f" | head -1); ` +
  `printf '%s|%s\\n' "$b" "$(dirname "$f")"; done`;

export async function listTrainedAdapters(): Promise<TrainedAdapter[]> {
  try {
    const { stdout } = await runHostScript(LIST_CMD, [], { timeoutMs: 20_000 });
    const seen = new Set<string>();
    const out: TrainedAdapter[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const s = line.trim();
      const bar = s.indexOf("|");
      if (bar < 0) continue;
      const base = s.slice(0, bar);
      const path = s.slice(bar + 1);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const m = /jobs\/([^/]+)\/models\//.exec(path);
      out.push({ jobId: m?.[1] ?? path, path, base });
    }
    return out;
  } catch {
    return [];
  }
}
