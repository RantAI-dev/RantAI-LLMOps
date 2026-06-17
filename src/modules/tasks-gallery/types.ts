// Mirrors a Transformer Lab gallery entry (task-gallery.json):
// { title, description, github_repo_url, github_repo_dir,
//   metadata: { category, modality, framework[] }, supportedAccelerators }
// Importing an entry creates a Task (template) in an experiment.

export const GALLERY_CATEGORIES = ["finetuning", "training", "rlhf", "evaluation"] as const;
export const GALLERY_FRAMEWORKS = [
  "unsloth",
  "huggingface",
  "trl",
  "diffusers",
  "sentence-transformers",
  "nanochat",
] as const;
export const GALLERY_MODALITIES = ["text", "audio", "image", "embedding"] as const;

export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];
export type GalleryFramework = (typeof GALLERY_FRAMEWORKS)[number];
export type GalleryModality = (typeof GALLERY_MODALITIES)[number];

export type GalleryTask = {
  id: string;
  title: string;
  description: string;
  githubRepoUrl: string;
  /** Path within the repo — the task.yaml + train.py live here in Transformer Lab. */
  githubRepoDir: string;
  category: GalleryCategory;
  modality: GalleryModality;
  framework: GalleryFramework[];
  /** Recommended accelerators, e.g. { nvidia: "RTX3090:1", amd: "7900XTX:1" }. */
  supportedAccelerators: { nvidia?: string; amd?: string };
};

export type GalleryFilters = {
  search: string;
  category: GalleryCategory | "all";
  framework: GalleryFramework | "all";
  modality: GalleryModality | "all";
};
