/**
 * Server-only helpers for chat history (`/api/conversations`).
 *
 * Backed by the TL `conversations` router we added to the source (mirrors the
 * `notes` router): one JSON file per conversation under the experiment dir. We
 * keep all chat sessions under a single experiment bucket so history is shared
 * across browsers/devices instead of stuck in one browser's localStorage.
 */
import { inferenceHeaders } from "@/lib/inference";
import { TL_ROOT } from "@/lib/models-catalog";

/** Experiment used purely as the storage bucket for chat conversations. */
const CHAT_EXPERIMENT = "nqr-ft";

const convUrl = (id?: string) =>
  `${TL_ROOT}/experiment/${CHAT_EXPERIMENT}/conversations${id ? `/${encodeURIComponent(id)}` : ""}`;

export async function listConversations(): Promise<unknown[]> {
  try {
    const res = await fetch(convUrl(), { headers: inferenceHeaders() });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function saveConversation(conversation: unknown): Promise<boolean> {
  try {
    const res = await fetch(convUrl(), {
      method: "POST",
      headers: inferenceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(conversation),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteConversation(id: string): Promise<boolean> {
  try {
    const res = await fetch(convUrl(id), { method: "DELETE", headers: inferenceHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}
