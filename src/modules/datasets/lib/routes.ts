import { detailHref } from "@/lib/detail-href";

/**
 * URL for a dataset's detail page (`/datasets/[...id]`). Dataset ids can contain
 * "/" (e.g. a Hugging Face repo id like "Trelis/touch-rugby-rules"), so the id is
 * segment-encoded and the catch-all route reassembles it.
 */
export function datasetHref(id: string): string {
  return detailHref("/datasets", id);
}
