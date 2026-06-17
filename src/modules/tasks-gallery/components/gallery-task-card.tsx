import { ArrowUpRight, Cpu, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GalleryTask } from "@/modules/tasks-gallery/types";

export function GalleryTaskCard({
  task,
  onImport,
}: {
  task: GalleryTask;
  onImport: () => void;
}) {
  const tags = [task.category, task.modality, ...task.framework];
  return (
    <div className="flex flex-col rounded-lg border border-border bg-white p-4 transition-colors hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-primary">{task.title}</h3>
        {task.framework.includes("unsloth") ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-strong">
            <Sparkles className="size-3" /> Unsloth
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 flex-1 text-[13px] leading-5 text-ink-soft">{task.description}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {tags.map((tag, i) => (
          <span
            key={`${task.id}-${tag}-${i}`}
            className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-soft"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-soft" title="Recommended accelerator">
          <Cpu className="size-3.5" />
          {task.supportedAccelerators.nvidia ?? task.supportedAccelerators.amd ?? "CPU"}
        </span>
        <div className="flex items-center gap-1">
          <a
            href={task.githubRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="grid size-7 place-items-center rounded-md text-ink-soft hover:bg-surface-2 hover:text-primary"
            title="View source on GitHub"
          >
            <ArrowUpRight className="size-3.5" />
          </a>
          <Button type="button" size="sm" className="h-8" onClick={onImport}>
            Import
          </Button>
        </div>
      </div>
    </div>
  );
}
