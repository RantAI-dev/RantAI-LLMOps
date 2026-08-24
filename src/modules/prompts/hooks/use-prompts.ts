"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchPrompt, fetchPrompts } from "@/modules/prompts/services/prompts-service";
import type { Prompt, PromptSummary } from "@/modules/prompts/types";

/**
 * Page-local Prompt Registry state (notes-style: self-contained, no app-wide
 * provider). Loads the list on mount, loads a selected prompt's full history on
 * demand, and re-syncs both after a mutation.
 */
export function usePrompts() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPrompts().then((list) => {
      if (!cancelled) {
        setPrompts(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    setPrompts(await fetchPrompts());
  }, []);

  const select = useCallback(async (id: string | null) => {
    setSelectedId(id);
    setSelected(null);
    if (!id) return;
    setDetailLoading(true);
    const p = await fetchPrompt(id);
    setSelected(p);
    setDetailLoading(false);
  }, []);

  /** After a create/version/alias/meta change, refresh the list and open detail. */
  const applyUpdate = useCallback(
    async (updated: Prompt | null) => {
      await reload();
      if (updated) {
        setSelectedId(updated.id);
        setSelected(updated);
      }
    },
    [reload]
  );

  /** After deleting the open prompt, clear selection and refresh the list. */
  const afterDelete = useCallback(async () => {
    setSelectedId(null);
    setSelected(null);
    await reload();
  }, [reload]);

  return { prompts, loading, selectedId, selected, detailLoading, select, applyUpdate, afterDelete };
}
