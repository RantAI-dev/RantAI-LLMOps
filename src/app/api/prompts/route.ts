import { createPrompt, findPromptByName, listPrompts, resolveVersion } from "@/lib/prompt-store";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prompt Registry — team-visible, versioned prompts (server-side file store).
 *
 * GET:
 *  - no query      → list summaries (newest-updated first)
 *  - ?name=X[&alias=production | &version=2]
 *                  → RESOLVE a prompt's text for programmatic use (e.g. an agent
 *                    fetching the production prompt). Returns { name, version, text }.
 * POST creates a prompt at version 1.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");

  // Resolve mode — for programmatic handoff (RantAI-Agents, etc.).
  if (name) {
    const alias = url.searchParams.get("alias") ?? undefined;
    const versionParam = url.searchParams.get("version");
    const version = versionParam != null && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined;
    try {
      const prompt = await findPromptByName(name);
      if (!prompt) return Response.json({ error: `No prompt named "${name}"` }, { status: 404 });
      const v = resolveVersion(prompt, { alias, version });
      if (!v) {
        const what = version != null ? `version ${version}` : alias ? `alias "${alias}"` : "any version";
        return Response.json({ error: `Prompt "${name}" has no ${what}` }, { status: 404 });
      }
      return Response.json({
        name: prompt.name,
        id: prompt.id,
        version: v.version,
        text: v.text,
        resolvedBy: version != null ? `version:${version}` : alias ? `alias:${alias}` : "latest",
      });
    } catch (err) {
      logServerError("prompts GET resolve", err);
      return Response.json({ error: "Failed to resolve prompt" }, { status: 500 });
    }
  }

  try {
    return Response.json({ prompts: await listPrompts() });
  } catch (err) {
    logServerError("prompts GET", err);
    return Response.json({ prompts: [] });
  }
}

export async function POST(req: Request) {
  let body: { name?: string; text?: string; description?: string; tags?: string[]; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const text = body.text ?? "";
  if (!name) return Response.json({ error: "A name is required" }, { status: 400 });
  if (!text.trim()) return Response.json({ error: "The prompt text is required" }, { status: 400 });
  try {
    const prompt = await createPrompt({
      name,
      text,
      description: body.description?.trim() || undefined,
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      note: body.note?.trim() || undefined,
    });
    return Response.json({ prompt }, { status: 201 });
  } catch (err) {
    logServerError("prompts POST", err);
    return Response.json({ error: "Failed to create prompt" }, { status: 500 });
  }
}
