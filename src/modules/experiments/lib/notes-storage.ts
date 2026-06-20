/**
 * Per-experiment notes persistence.
 *
 * Transformer Lab does have a notes API (`/experiment/{id}/notes`) in newer
 * builds, but the running `transformerlab/api:latest` image we target doesn't
 * expose it yet (404 / absent from its OpenAPI). So notes are persisted in the
 * browser's localStorage — the same approach as the chat history. If the TL
 * container is later updated to a build with the notes endpoint, swap these two
 * functions for a BFF call and the editor keeps working unchanged.
 */

const PREFIX = "nqr.notes.";

export function loadNote(experimentId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PREFIX + experimentId);
  } catch {
    return null;
  }
}

export function saveNote(experimentId: string, content: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + experimentId, content);
  } catch {
    // ignore quota/serialization errors — notes are best-effort
  }
}
