import type { EnginePlugin, TaskType } from "@/modules/tasks/types";
import type { GalleryTask } from "@/modules/tasks-gallery/types";

/** Map a gallery entry's framework to the closest nqllmops engine plugin. */
export function frameworkToEngine(task: GalleryTask): EnginePlugin {
  if (task.framework.includes("unsloth")) return "Unsloth";
  if (task.framework.includes("trl") || task.framework.includes("huggingface")) return "TRL";
  return "Custom PyTorch";
}

/** Map a gallery entry's category/modality to a Task type. */
export function categoryToTaskType(task: GalleryTask): TaskType {
  if (task.modality === "embedding") return "Embedding Fine-tuning";
  if (task.category === "finetuning") return "Fine-tuning";
  return "Training";
}

/** Parse the recommended accelerator string ("RTX3090:1") into a GPU count. */
export function recommendedGpuCount(task: GalleryTask): number {
  const spec = task.supportedAccelerators.nvidia ?? task.supportedAccelerators.amd;
  const count = spec ? Number(spec.split(":")[1]) : 1;
  return Number.isFinite(count) && count > 0 ? count : 1;
}
