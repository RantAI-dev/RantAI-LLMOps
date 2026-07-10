"use client";

import { Boxes, Cpu, Server, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useResourceFetch } from "@/lib/use-resource-fetch";
import { GpuMeters } from "@/modules/compute/components/gpu-meters";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import {
  fetchComputeProviders,
  removeComputeProvider,
  seedComputeProviders,
} from "@/modules/compute/services/compute-service";
import type {
  Cluster,
  ClusterState,
  ComputeProvider,
  ProviderStatus,
} from "@/modules/compute/types";
import { cn } from "@/lib/utils";

const providerStatusStyles: Record<ProviderStatus, string> = {
  Connected: "bg-success-soft text-success",
  Configuring: "bg-warning-soft text-warning",
  Error: "bg-danger-soft text-danger",
  Disabled: "bg-surface-2 text-ink-faint-strong",
};

const clusterStateStyles: Record<ClusterState, string> = {
  up: "bg-success-soft text-success",
  init: "bg-warning-soft text-warning",
  stopped: "bg-surface-2 text-ink-faint-strong",
  down: "bg-surface-2 text-ink-faint-strong",
  failed: "bg-danger-soft text-danger",
  unknown: "bg-surface-2 text-ink-faint-strong",
};

export function ComputePage() {
  const [providers, setProviders] = useState<ComputeProvider[]>(seedComputeProviders);
  // `always: true` — the BFF reads the real provider list with a server-side key,
  // independent of the app-auth mock flag.
  const providersFetch = useResourceFetch(setProviders, fetchComputeProviders, { always: true });

  const summary = useMemo(() => {
    const localGpus = providers
      .flatMap((p) => p.accelerators)
      .reduce((sum, a) => sum + a.count, 0);
    const activeClusters = providers
      .flatMap((p) => p.clusters)
      .filter((c) => c.state === "up").length;
    const defaultProvider = providers.find((p) => p.isDefault);
    return { localGpus, activeClusters, defaultProvider };
  }, [providers]);

  const removeProvider = (id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id)); // optimistic
    void removeComputeProvider(id).then(() => providersFetch.reload());
  };

  const cards = [
    { label: "Providers", value: String(providers.length), icon: Server, tint: "bg-primary-soft text-primary" },
    { label: "Default", value: summary.defaultProvider?.name ?? "—", icon: Star, tint: "bg-warning-soft text-warning" },
    { label: "Local GPUs", value: String(summary.localGpus), icon: Cpu, tint: "bg-success-soft text-success" },
    { label: "Active clusters", value: String(summary.activeClusters), icon: Boxes, tint: "bg-info-soft text-info" },
  ];

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={cn("text-primary", taskUi.title)}>Compute</h1>
          <p className={cn("mt-1 max-w-2xl", taskUi.subheading)}>
            Where Transformer Lab runs training & inference jobs. On this self-host that&apos;s your
            local machine + its GPU.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-[13px] font-medium text-ink-soft">{card.label}</CardTitle>
                <div className={cn("rounded p-1", card.tint)}>
                  <card.icon className="size-4" aria-hidden />
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className={cn("truncate text-primary", taskUi.metric)}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Cpu className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">GPU realtime</h2>
          <span className="text-[11px] text-ink-soft">nvidia-smi · refresh tiap ~2,5 dtk</span>
        </div>
        <GpuMeters />
      </section>

      {providersFetch.isLoading ? (
        <LoadingState label="Loading compute providers…" />
      ) : providersFetch.isError ? (
        <ErrorState onRetry={providersFetch.reload} />
      ) : providers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No compute providers"
          description="Transformer Lab reports no providers. On a self-host you'd normally see a built-in 'Local' provider — check that the backend is running."
        />
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onRemove={() => removeProvider(provider.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  onRemove,
}: {
  provider: ComputeProvider;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-primary">{provider.name}</h3>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">
              {provider.type}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", providerStatusStyles[provider.status])}>
              {provider.status}
            </span>
            {provider.isDefault ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-strong">
                <Star className="size-3" /> Default
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-ink-soft">{provider.detail}</p>
        </div>
        <div className="flex items-center gap-1">
          {provider.type !== "Local" ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove} title="Remove provider">
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {provider.accelerators.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-xs font-medium text-ink">Detected accelerators</p>
          <div className="flex flex-wrap gap-2">
            {provider.accelerators.map((a, i) => (
              <span
                key={`${provider.id}-acc-${i}`}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
              >
                <Cpu className="size-3.5 text-primary" />
                {a.count}× {a.name} ({a.vramGb}GB)
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {provider.clusters.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-ink">Clusters</p>
          {provider.clusters.map((cluster) => (
            <ClusterRow key={cluster.name} cluster={cluster} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ClusterRow({ cluster }: { cluster: Cluster }) {
  const running = cluster.jobs.filter((j) => j.state === "running").length;
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{cluster.name}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", clusterStateStyles[cluster.state])}>
            {cluster.state}
          </span>
        </div>
        <span className="text-xs text-ink-soft">
          {cluster.numNodes} node{cluster.numNodes > 1 ? "s" : ""}
          {running > 0 ? ` · ${running} running` : ""}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">{cluster.resourcesStr}</p>
    </div>
  );
}
