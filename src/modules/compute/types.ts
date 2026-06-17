// Mirrors Transformer Lab's compute_provider model:
//  - provider types match the installer (Local, SkyPilot, Slurm, RunPod, …)
//  - ClusterState / JobState / ResourceInfo come from
//    api/transformerlab/compute_providers/models.py

export const PROVIDER_TYPES = [
  "Local",
  "SkyPilot",
  "Slurm",
  "RunPod",
  "dstack",
  "AWS",
  "GCP",
  "Azure",
  "Vast.ai",
] as const;

export const PROVIDER_STATUSES = ["Connected", "Configuring", "Error", "Disabled"] as const;

// ClusterState enum (TL models.py)
export const CLUSTER_STATES = ["up", "init", "stopped", "down", "failed", "unknown"] as const;

// JobState enum (TL models.py)
export const JOB_STATES = ["pending", "running", "completed", "failed", "cancelled", "unknown"] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export type ClusterState = (typeof CLUSTER_STATES)[number];
export type JobState = (typeof JOB_STATES)[number];

export type Accelerator = {
  name: string;
  count: number;
  vramGb: number;
};

export type ClusterJob = {
  id: string;
  name: string;
  state: JobState;
  submittedAt?: string;
};

export type Cluster = {
  name: string;
  state: ClusterState;
  /** Human-readable resource string, e.g. "1x A100 (80GB), 12 vCPU, 85GB RAM". */
  resourcesStr: string;
  numNodes: number;
  launchedAt?: string;
  /** Minutes until autostop (TL ClusterStatus.autostop). */
  autostopMinutes?: number;
  gpus: Accelerator[];
  cpus?: number;
  memoryGb?: number;
  jobs: ClusterJob[];
};

export type ComputeProvider = {
  id: string;
  type: ProviderType;
  name: string;
  status: ProviderStatus;
  isDefault: boolean;
  detail: string;
  /** Local provider: accelerators detected on this host (TL /detect-accelerators). */
  accelerators: Accelerator[];
  /** Remote providers: launched clusters (TL /clusters). */
  clusters: Cluster[];
};

export type AddProviderInput = {
  type: ProviderType;
  name: string;
  detail: string;
};
