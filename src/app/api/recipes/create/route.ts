import type { NextRequest } from "next/server";

import { createExperimentFromRecipe } from "@/lib/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create an experiment from a recipe (pre-loads its train/eval/generate tasks). */
export async function POST(req: NextRequest) {
  let body: { recipeId?: string; experimentName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.recipeId || !body.experimentName) {
    return Response.json(
      { error: "`recipeId` and `experimentName` are required" },
      { status: 400 }
    );
  }
  const result = await createExperimentFromRecipe(body.recipeId, body.experimentName);
  if (!result.ok) {
    return Response.json({ error: result.detail || "Failed to create experiment" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
