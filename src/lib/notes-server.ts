/**
 * Server-only helpers for per-experiment Notes (`/api/experiments/[id]/notes`).
 *
 * Transformer Lab v0.40.0 exposes a notes API at `/experiment/{id}/notes`
 * (markdown, stored under the experiment dir). GET returns the content as a JSON
 * string; POST takes the content as a raw JSON string body. We back the Notes
 * editor with this so notes live with the experiment (and are team-visible),
 * not just in one browser's localStorage.
 */
import { inferenceHeaders } from "@/lib/inference";
import { TL_ROOT } from "@/lib/models-catalog";

export async function getExperimentNotes(experimentId: string): Promise<string> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${encodeURIComponent(experimentId)}/notes`,
      { headers: inferenceHeaders() }
    );
    if (!res.ok) return "";
    const data = await res.json().catch(() => "");
    return typeof data === "string" ? data : "";
  } catch {
    return "";
  }
}

export async function saveExperimentNotes(
  experimentId: string,
  content: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${encodeURIComponent(experimentId)}/notes`,
      {
        method: "POST",
        headers: inferenceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(content), // the endpoint wants the note as a raw JSON string
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
