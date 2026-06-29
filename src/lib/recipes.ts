/**
 * Server-only helpers for Recipes (`/api/recipes/*`).
 *
 * v0.40.0 removed the `/recipes` API (recipes were a v0.30.x concept). The
 * equivalent is the **task gallery** — pre-built trainer/eval/inference task
 * templates (Unsloth, TRL, lm-eval, …). We surface those here so the page is a
 * useful "starting points" browser, and "use" creates an experiment to work in.
 */
import { inferenceHeaders } from "@/lib/inference";
import { TL_ROOT } from "@/lib/models-catalog";
import { listTlExperiments } from "@/lib/tasks-server";

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

type TlGalleryTask = {
  title?: string;
  description?: string;
  github_repo_dir?: string;
  metadata?: { category?: string; modality?: string; framework?: string[] };
  supportedAccelerators?: Record<string, unknown>;
};

/** The gallery is experiment-scoped at the API but identical everywhere. */
const GALLERY_EXPERIMENT = "alpha";

function normalize(t: TlGalleryTask): Recipe {
  const dir = t.github_repo_dir ?? "";
  const id = dir.split("/").pop() || (t.title ?? "task");
  const framework = Array.isArray(t.metadata?.framework) ? t.metadata!.framework! : [];
  return {
    id,
    title: t.title ?? id,
    description: t.description ?? "",
    notes: "",
    arch: framework,
    models: [],
    datasets: [],
    plugins: [],
    taskTypes: t.metadata?.category ? [t.metadata.category] : [],
    cardImage: null,
  };
}

/**
 * Pre-built task templates from the v0.40.0 task gallery
 * (`GET /experiment/{id}/task/gallery`). Degrades to empty on error.
 */
export async function listRecipes(): Promise<Recipe[]> {
  try {
    const res = await fetch(`${TL_ROOT}/experiment/${GALLERY_EXPERIMENT}/task/gallery`, {
      headers: inferenceHeaders(),
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { data?: TlGalleryTask[] } | TlGalleryTask[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    return rows.filter((t) => t.title || t.github_repo_dir).map(normalize);
  } catch {
    return [];
  }
}

/**
 * "Use" a starting point = create an experiment to work in. v0.40.0 has no
 * auto-load-tasks-into-experiment step (that was a v0.30.x recipe feature), so
 * we just create the experiment; the user then configures Fine-tune/Evals there.
 */
export async function createExperimentFromRecipe(
  _recipeId: string,
  experimentName: string
): Promise<{ ok: boolean; detail?: string }> {
  void _recipeId;
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/create?name=${encodeURIComponent(experimentName)}`,
      { headers: inferenceHeaders() }
    );
    if (res.ok) return { ok: true };
    // 409 = already exists, which is fine for our purposes.
    if (res.status === 409) return { ok: true };
    const exists = (await listTlExperiments()).some((e) => e.name === experimentName);
    return exists ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Gagal membuat experiment" };
  }
}
