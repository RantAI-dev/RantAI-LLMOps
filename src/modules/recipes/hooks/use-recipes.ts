"use client";

import { useCallback, useEffect, useState } from "react";

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

/**
 * Drives the Recipes gallery: load the curated recipes and create an experiment
 * from one (which pre-loads its train/eval/generate tasks).
 */
export function useRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recipes/list", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ recipes?: Recipe[] }>)
      .then((d) => {
        if (cancelled) return;
        setRecipes(Array.isArray(d.recipes) ? d.recipes : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createExperiment = useCallback(
    async (recipeId: string, experimentName: string) => {
      setError(null);
      setCreating(recipeId);
      try {
        const res = await fetch("/api/recipes/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipeId, experimentName }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error || "Gagal membuat experiment");
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setCreating(null);
      }
    },
    []
  );

  return { recipes, loading, creating, error, createExperiment };
}
