"use client";

import { useState } from "react";
import { BookTemplate, Database, Boxes, Check, Loader2, Plug, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { LoadingState } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRecipes, type Recipe } from "@/modules/recipes/hooks/use-recipes";

/** This deployment runs Transformer Lab on an NVIDIA GPU. */
const HOST_ARCH = "cuda";

function isCompatible(recipe: Recipe): boolean {
  // No declared requirement → assume it runs; otherwise it must list our arch.
  return recipe.arch.length === 0 || recipe.arch.includes(HOST_ARCH);
}

function suffix(): string {
  // Short unique-ish tag so repeated "Use" calls don't collide on experiment name.
  return Math.floor(Date.now() / 1000)
    .toString(36)
    .slice(-4);
}

const TASK_COLORS: Record<string, string> = {
  TRAIN: "bg-primary-soft text-primary",
  EVAL: "bg-info-soft text-info-bright",
  GENERATE: "bg-purple-soft text-purple-bright",
  EXPORT: "bg-warning-soft text-warning-gold",
};

function RecipeCard({
  recipe,
  creating,
  onUse,
}: {
  recipe: Recipe;
  creating: boolean;
  onUse: () => void;
}) {
  const compatible = isCompatible(recipe);
  const counts = [
    { icon: <Boxes className="size-3.5" />, n: recipe.models.length, label: "model" },
    { icon: <Database className="size-3.5" />, n: recipe.datasets.length, label: "dataset" },
    { icon: <Plug className="size-3.5" />, n: recipe.plugins.length, label: "plugin" },
  ];
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-primary">{recipe.title}</h3>
        {compatible ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            NVIDIA ✓
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">
            {recipe.arch.join("/").toUpperCase() || "?"} only
          </span>
        )}
      </div>

      <p className="mb-3 line-clamp-3 text-[13px] text-ink-soft">{recipe.description || "—"}</p>

      {recipe.taskTypes.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {recipe.taskTypes.map((t, i) => (
            <span
              key={`${t}-${i}`}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                TASK_COLORS[t] ?? "bg-surface-2 text-ink-soft"
              )}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
        {counts.map((c) => (
          <span key={c.label} className="inline-flex items-center gap-1">
            {c.icon}
            {c.n} {c.label}
            {c.n === 1 ? "" : "s"}
          </span>
        ))}
      </div>

      <div className="mt-auto">
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!compatible || creating}
          onClick={onUse}
          title={compatible ? undefined : "Recipe ini butuh arsitektur lain (mis. Mac/MLX)."}
        >
          {creating ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Membuat…
            </>
          ) : compatible ? (
            <>
              <Wand2 className="size-4" /> Pakai recipe
            </>
          ) : (
            "Tidak kompatibel"
          )}
        </Button>
      </div>
    </div>
  );
}

/** Recipes: ready-made LLMOps pipelines. Using one creates a pre-loaded experiment. */
export function RecipesPage() {
  const { recipes, loading, creating, error, createExperiment } = useRecipes();
  const [done, setDone] = useState<string | null>(null);

  const handleUse = async (recipe: Recipe) => {
    const name = `${recipe.id}-${suffix()}`;
    const ok = await createExperiment(recipe.id, name);
    if (ok) {
      setDone(name);
      toast.success(`Experiment "${name}" dibuat`, {
        description: "Buka menu Experiments / Tasks buat jalanin task-nya.",
      });
    }
  };

  const compatibleCount = recipes.filter(isCompatible).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
          <BookTemplate className="size-5" /> Recipes
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Template LLMOps siap-pakai dari Transformer Lab — model + dataset + task (train/eval/generate)
          udah dikonfigurasi. Klik <strong>Pakai recipe</strong> buat bikin experiment yang langsung
          jalan, nggak perlu setup dari nol.
        </p>
      </div>

      {loading ? (
        <LoadingState label="Loading recipes…" />
      ) : recipes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-ink-soft">
          Tidak ada recipe. Cek koneksi ke Transformer Lab.
        </p>
      ) : (
        <>
          {done ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
              <Check className="size-4" /> Experiment <span className="font-mono">{done}</span> dibuat. Buka
              menu <strong>Experiments</strong> atau <strong>Tasks</strong> buat jalanin.
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </div>
          ) : null}
          <p className="text-[12px] text-ink-soft">
            {recipes.length} recipe · {compatibleCount} kompatibel dengan GPU NVIDIA-mu.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((r) => (
              <RecipeCard
                key={r.id}
                recipe={r}
                creating={creating === r.id}
                onUse={() => handleUse(r)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
