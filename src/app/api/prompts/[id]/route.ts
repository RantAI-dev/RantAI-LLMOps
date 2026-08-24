import { deletePrompt, getPrompt, setPromptAlias, updatePromptMeta } from "@/lib/prompt-store";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full prompt (with its version history). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const prompt = await getPrompt(id);
    if (!prompt) return Response.json({ error: "Prompt not found" }, { status: 404 });
    return Response.json({ prompt });
  } catch (err) {
    logServerError("prompts/[id] GET", err);
    return Response.json({ error: "Failed to read prompt" }, { status: 500 });
  }
}

/**
 * Update a prompt. Two shapes, discriminated by the body:
 *  - { alias, version }        → point/clear an alias (version=null clears it)
 *  - { name?, description?, tags? } → patch metadata
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { alias?: string; version?: number | null; name?: string; description?: string; tags?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    if (typeof body.alias === "string") {
      const prompt = await setPromptAlias(id, body.alias.trim(), body.version ?? null);
      if (!prompt) return Response.json({ error: "Prompt not found" }, { status: 404 });
      return Response.json({ prompt });
    }
    const prompt = await updatePromptMeta(id, {
      name: body.name?.trim() || undefined,
      description: body.description,
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : undefined,
    });
    if (!prompt) return Response.json({ error: "Prompt not found" }, { status: 404 });
    return Response.json({ prompt });
  } catch (err) {
    // setPromptAlias throws on an unknown version → that's a bad request, not a 500.
    const msg = err instanceof Error ? err.message : "Failed to update prompt";
    if (/has no version/.test(msg)) return Response.json({ error: msg }, { status: 400 });
    logServerError("prompts/[id] PATCH", err);
    return Response.json({ error: "Failed to update prompt" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deletePrompt(id);
    return Response.json({ ok: true });
  } catch (err) {
    logServerError("prompts/[id] DELETE", err);
    return Response.json({ error: "Failed to delete prompt" }, { status: 500 });
  }
}
