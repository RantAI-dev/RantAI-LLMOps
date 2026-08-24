import { addPromptVersion } from "@/lib/prompt-store";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Append a new version to a prompt (auto-incrementing the version number). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { text?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.text || !body.text.trim()) {
    return Response.json({ error: "The prompt text is required" }, { status: 400 });
  }
  try {
    const prompt = await addPromptVersion(id, { text: body.text, note: body.note?.trim() || undefined });
    if (!prompt) return Response.json({ error: "Prompt not found" }, { status: 404 });
    return Response.json({ prompt }, { status: 201 });
  } catch (err) {
    logServerError("prompts/[id]/versions POST", err);
    return Response.json({ error: "Failed to add version" }, { status: 500 });
  }
}
