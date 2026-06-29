/**
 * Server-only helpers for Recipes (`/api/recipes/*`).
 *
 * A Transformer Lab "recipe" is a ready-made LLMOps pipeline — a curated bundle
 * of model + dataset + plugin dependencies and a set of pre-configured tasks
 * (train / eval / generate). Using one creates an experiment pre-loaded with
 * those tasks, so the user starts from a working setup instead of from scratch.
 */
import { inferenceHeaders } from "@/lib/inference";
import { TL_ROOT } from "@/lib/models-catalog";
import { listTlExperiments } from "@/lib/tasks-server";

export type RecipeDep = { type: string; name: string };
export type RecipeTask = { task_type?: string; name?: string };

export type Recipe = {
  id: string;
  title: string;
  description: string;
  notes: string;
  arch: string[];
  models: string[];
  datasets: string[];
  plugins: string[];
  taskTypes: string[];
  cardImage: string | null;
};

type TlRecipe = {
  id?: string;
  title?: string;
  description?: string;
  notes?: string;
  requiredMachineArchitecture?: string[];
  dependencies?: RecipeDep[];
  tasks?: RecipeTask[];
  cardImage?: string | null;
};

function normalize(r: TlRecipe): Recipe {
  const deps = Array.isArray(r.dependencies) ? r.dependencies : [];
  const tasks = Array.isArray(r.tasks) ? r.tasks : [];
  const byType = (t: string) => deps.filter((d) => d.type === t).map((d) => d.name);
  return {
    id: String(r.id ?? ""),
    title: r.title ?? String(r.id ?? "Recipe"),
    description: r.description ?? "",
    notes: r.notes ?? "",
    arch: Array.isArray(r.requiredMachineArchitecture) ? r.requiredMachineArchitecture : [],
    models: byType("model"),
    datasets: byType("dataset"),
    plugins: byType("plugin"),
    taskTypes: tasks.map((t) => t.task_type ?? "TASK"),
    cardImage: r.cardImage ?? null,
  };
}

/**
 * Curated recipe gallery (`GET /recipes/list`).
 *
 * NOTE: Transformer Lab v0.40.0 removed the `/recipes` API (recipes were a
 * v0.30.x concept). We degrade gracefully to an empty list so the page shows its
 * empty-state instead of erroring. The v0.40.0 equivalent is the task gallery
 * (used directly by Fine-tune/Evals), so this page is informational for now.
 */
export async function listRecipes(): Promise<Recipe[]> {
  try {
    const res = await fetch(`${TL_ROOT}/recipes/list`, { headers: inferenceHeaders() });
    if (!res.ok) return [];
    const rows = (await res.json().catch(() => [])) as TlRecipe[];
    return (Array.isArray(rows) ? rows : []).filter((r) => r.id).map(normalize);
  } catch {
    return [];
  }
}

/**
 * Create an experiment pre-loaded with a recipe's tasks
 * (`POST /recipes/{id}/create_experiment?experiment_name=…`).
 */
export async function createExperimentFromRecipe(
  recipeId: string,
  experimentName: string
): Promise<{ ok: boolean; detail?: string }> {
  const url = `${TL_ROOT}/recipes/${encodeURIComponent(recipeId)}/create_experiment?experiment_name=${encodeURIComponent(
    experimentName
  )}`;
  const res = await fetch(url, { method: "POST", headers: inferenceHeaders() });
  if (res.ok) return { ok: true };
  // TL often returns a 500 (empty body) from a non-fatal post-create step even
  // though the experiment itself WAS created. Verify by existence rather than
  // trusting the status code.
  const data = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
  try {
    const exists = (await listTlExperiments()).some((e) => e.name === experimentName);
    if (exists) return { ok: true };
  } catch {
    /* fall through to error */
  }
  return { ok: false, detail: data.detail || data.message || `HTTP ${res.status}` };
}
