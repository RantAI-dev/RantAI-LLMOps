"use client";

import { CheckCircle2, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { FilterSelect } from "@/modules/tasks/components/filter-select";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";
import { GALLERY_TASKS } from "@/modules/tasks-gallery/data/gallery-tasks";
import {
  GALLERY_CATEGORIES,
  GALLERY_FRAMEWORKS,
  GALLERY_MODALITIES,
  type GalleryFilters,
  type GalleryTask,
} from "@/modules/tasks-gallery/types";
import { GalleryTaskCard } from "./gallery-task-card";
import { ImportGalleryTaskSheet } from "./import-gallery-task-sheet";
import { cn } from "@/lib/utils";

const DEFAULT_FILTERS: GalleryFilters = {
  search: "",
  category: "all",
  framework: "all",
  modality: "all",
};

export function TasksGalleryPage() {
  const { experiments, createTask } = useLlmOps();
  const [filters, setFilters] = useState<GalleryFilters>(DEFAULT_FILTERS);
  const [importTask, setImportTask] = useState<GalleryTask | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return GALLERY_TASKS.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) {
        return false;
      }
      if (filters.category !== "all" && t.category !== filters.category) return false;
      if (filters.framework !== "all" && !t.framework.includes(filters.framework)) return false;
      if (filters.modality !== "all" && t.modality !== filters.modality) return false;
      return true;
    });
  }, [filters]);

  const unslothCount = GALLERY_TASKS.filter((t) => t.framework.includes("unsloth")).length;

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="border-b border-border pb-4">
        <h1 className={cn("text-primary", taskUi.title)}>Tasks Gallery</h1>
        <p className={cn("mt-1 max-w-2xl", taskUi.subheading)}>
          Browse Transformer Lab&apos;s task recipes and import one into an experiment. Each recipe is a
          GitHub-backed task (task.yaml + train.py).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
        <span>
          <strong className="text-primary">{GALLERY_TASKS.length}</strong> recipes
        </span>
        <span className="inline-flex items-center gap-1">
          <Sparkles className="size-3.5 text-primary-strong" />
          <strong className="text-primary-strong">{unslothCount}</strong> Unsloth (faster, less VRAM)
        </span>
      </div>

      {imported ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-success-border bg-success-soft px-3 py-2 text-[13px] text-success">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            Imported “{imported}” — a queued run was created. Open <strong>Tasks</strong> to start it.
          </span>
          <button type="button" onClick={() => setImported(null)} aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[260px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" />
          <Input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search recipes..."
            className="pl-9"
          />
        </div>
        <FilterSelect
          label="Filter by category"
          value={filters.category}
          onChange={(v) => setFilters((f) => ({ ...f, category: v as GalleryFilters["category"] }))}
          options={[
            { value: "all", label: "All categories" },
            ...GALLERY_CATEGORIES.map((c) => ({ value: c, label: c })),
          ]}
          className="w-[160px]"
        />
        <FilterSelect
          label="Filter by framework"
          value={filters.framework}
          onChange={(v) => setFilters((f) => ({ ...f, framework: v as GalleryFilters["framework"] }))}
          options={[
            { value: "all", label: "All frameworks" },
            ...GALLERY_FRAMEWORKS.map((fw) => ({ value: fw, label: fw })),
          ]}
          className="w-[170px]"
        />
        <FilterSelect
          label="Filter by modality"
          value={filters.modality}
          onChange={(v) => setFilters((f) => ({ ...f, modality: v as GalleryFilters["modality"] }))}
          options={[
            { value: "all", label: "All modalities" },
            ...GALLERY_MODALITIES.map((m) => ({ value: m, label: m })),
          ]}
          className="w-[150px]"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-[14px] text-ink-soft">
          No recipes match your filters.{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((task) => (
            <GalleryTaskCard key={task.id} task={task} onImport={() => setImportTask(task)} />
          ))}
        </div>
      )}

      <ImportGalleryTaskSheet
        key={importTask?.id ?? "none"}
        task={importTask}
        experiments={experiments}
        onClose={() => setImportTask(null)}
        onImport={(input) => {
          const id = createTask(input);
          if (id) setImported(input.name);
          return id;
        }}
      />
    </div>
  );
}
