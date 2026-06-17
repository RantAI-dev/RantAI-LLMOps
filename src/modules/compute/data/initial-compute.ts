import type { ComputeProvider } from "@/modules/compute/types";

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

export const initialProviders: ComputeProvider[] = [
  {
    id: "prov-local",
    type: "Local",
    name: "This machine",
    status: "Connected",
    isDefault: true,
    detail: "Runs jobs directly on this host (no remote cluster).",
    accelerators: [{ name: "NVIDIA RTX 4090", count: 1, vramGb: 24 }],
    clusters: [],
  },
  {
    id: "prov-runpod",
    type: "RunPod",
    name: "RunPod (serverless)",
    status: "Connected",
    isDefault: false,
    detail: "Serverless GPU pods on the RunPod marketplace.",
    accelerators: [],
    clusters: [
      {
        name: "rp-a100-train",
        state: "up",
        resourcesStr: "1x A100 (80GB), 12 vCPU, 85GB RAM",
        numNodes: 1,
        launchedAt: hoursAgo(3),
        autostopMinutes: 30,
        gpus: [{ name: "NVIDIA A100", count: 1, vramGb: 80 }],
        cpus: 12,
        memoryGb: 85,
        jobs: [
          { id: "job-9f2a", name: "unsloth-llm-train", state: "running", submittedAt: hoursAgo(2.5) },
          { id: "job-7c10", name: "trl-eval", state: "completed", submittedAt: hoursAgo(6) },
        ],
      },
    ],
  },
  {
    id: "prov-aws",
    type: "AWS",
    name: "AWS us-east-1",
    status: "Configuring",
    isDefault: false,
    detail: "Launch EC2 GPU instances directly on AWS (beta). Credentials pending.",
    accelerators: [],
    clusters: [
      {
        name: "aws-g5-eval",
        state: "stopped",
        resourcesStr: "1x A10G (24GB), 8 vCPU, 32GB RAM",
        numNodes: 1,
        launchedAt: hoursAgo(28),
        gpus: [{ name: "NVIDIA A10G", count: 1, vramGb: 24 }],
        cpus: 8,
        memoryGb: 32,
        jobs: [],
      },
    ],
  },
];
