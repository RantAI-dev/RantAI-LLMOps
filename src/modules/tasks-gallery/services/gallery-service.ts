import { USE_REAL_API } from "@/lib/api/config";
import { GALLERY_TASKS } from "@/modules/tasks-gallery/data/gallery-tasks";
import type { GalleryTask } from "@/modules/tasks-gallery/types";

/**
 * The data seam for the Tasks Gallery. Mock today (Transformer Lab's stable
 * task-gallery, kept verbatim); real wiring later. The page calls THESE so the
 * mock→real swap stays in one place.
 *
 * NOTE: TL serves the gallery at `/task/gallery`; the real fetch + mapping is an
 * intentional TODO.
 */

/** Sync seed for instant initial render while the real API is off. */
export function seedGalleryTasks(): GalleryTask[] {
  return GALLERY_TASKS;
}

/** Async load — mock today; real `GET /task/gallery` (+ mapping) is a TODO. */
export async function fetchGalleryTasks(): Promise<GalleryTask[]> {
  if (!USE_REAL_API) return GALLERY_TASKS;
  // TODO: GET /task/gallery and map TL gallery entries into GalleryTask.
  return GALLERY_TASKS;
}
