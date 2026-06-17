import type { GalleryTask } from "@/modules/tasks-gallery/types";

const REPO = "https://github.com/transformerlab/transformerlab-app";

/**
 * Real entries from Transformer Lab's stable task gallery
 * (api/transformerlab/galleries/channels/stable/latest/task-gallery.json).
 * Kept verbatim so importing here maps 1:1 to TL's gallery import when wired.
 */
export const GALLERY_TASKS: GalleryTask[] = [
  {
    id: "trl-training-evals",
    title: "HF Training with Evals",
    description:
      "Train a language model with the TRL library on a dataset, with evaluation via the EleutherAI Harness.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/trl-training-evals",
    category: "finetuning",
    modality: "text",
    framework: ["huggingface", "trl"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "ppo-train",
    title: "PPO Trainer with TRL",
    description: "Train a language model using the PPO algorithm from the TRL library on a dataset.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/ppo-train",
    category: "rlhf",
    modality: "text",
    framework: ["huggingface", "trl"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "autotrain-sft",
    title: "AutoTrain SFT Training",
    description:
      "SFT training using Hugging Face AutoTrain. Requires a Hugging Face token (HF_TOKEN) for model access.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/autotrain-sft",
    category: "finetuning",
    modality: "text",
    framework: ["huggingface"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "unsloth-llm-train",
    title: "Unsloth LLM Fine-tuning",
    description:
      "LLM training with Unsloth FastLanguageModel + LoRA. 2x faster, less VRAM. Requires HF_TOKEN for model access.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/unsloth-llm-train",
    category: "finetuning",
    modality: "text",
    framework: ["unsloth"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "unsloth-grpo-train",
    title: "Unsloth GRPO Training",
    description:
      "GRPO trainer based on the Unsloth GRPO notebooks — train models with reasoning capabilities.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/unsloth-grpo-train",
    category: "training",
    modality: "text",
    framework: ["unsloth"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "unsloth-text-to-speech-train",
    title: "Unsloth Text-to-Speech Training",
    description: "Text-to-Speech (TTS) trainer based on the Unsloth audio training notebooks.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/unsloth-text-to-speech-train",
    category: "training",
    modality: "audio",
    framework: ["unsloth"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "diffusion-train",
    title: "Diffusion LoRA Trainer",
    description:
      "LoRA trainer for Stable Diffusion models. Trains on captioned images and generates samples before/after.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/diffusion-train",
    category: "training",
    modality: "image",
    framework: ["diffusers"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "embedding-model-train",
    title: "Embedding Model Trainer",
    description:
      "Train embedding models with Sentence Transformers. Supports various dataset types and loss functions.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/embedding-model-train",
    category: "training",
    modality: "embedding",
    framework: ["sentence-transformers"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "gpt-oss",
    title: "GPT-OSS Trainer",
    description: "Trainer for GPT-OSS models using the HuggingFace SFTTrainer with optional LoRA fine-tuning.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/gpt-oss",
    category: "finetuning",
    modality: "text",
    framework: ["huggingface"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
  {
    id: "nanochat",
    title: "NanoChat Trainer",
    description:
      "Full NanoChat speedrun pipeline: tokenizer training, base pretraining, midtraining, and SFT on GSM8K.",
    githubRepoUrl: REPO,
    githubRepoDir: "api/transformerlab/galleries/examples/nanochat",
    category: "finetuning",
    modality: "text",
    framework: ["nanochat"],
    supportedAccelerators: { nvidia: "RTX3090:1", amd: "7900XTX:1" },
  },
];
