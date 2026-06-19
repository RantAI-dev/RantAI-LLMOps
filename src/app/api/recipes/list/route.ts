import { listRecipes } from "@/lib/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Curated recipe gallery from Transformer Lab. Degrades to empty on error. */
export async function GET() {
  try {
    const recipes = await listRecipes();
    return Response.json({ recipes });
  } catch {
    return Response.json({ recipes: [] });
  }
}
