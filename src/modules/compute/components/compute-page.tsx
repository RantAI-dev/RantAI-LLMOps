"use client";

import { Boxes, Cpu, Plus, Server, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { initialProviders } from "@/modules/compute/data/initial-compute";
import type {
  AddProviderInput,
  Cluster,
  ClusterState,
  ComputeProvider,
  ProviderStatus,
} from "@/modules/compute/types";
import { AddProviderSheet } from "./add-provider-sheet";
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

function makeId() {
  return `prov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ComputePage() {
  const [providers, setProviders] = useState<ComputeProvider[]>(initialProviders);
  const [isAddOpen, setIsAddOpen] = useState(false);

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

  const addProvider = (input: AddProviderInput) => {
    setProviders((prev) => [
      ...prev,
      {
        id: makeId(),
        type: input.type,
        name: input.name,
        detail: input.detail || "Configure credentials & clusters to start running jobs.",
        status: "Configuring",
        isDefault: false,
        accelerators: [],
        clusters: [],
      },
    ]);
  };

  const setDefault = (id: string) =>
    setProviders((prev) => prev.map((p) => ({ ...p, isDefault: p.id === id })));

  const removeProvider = (id: string) =>
    setProviders((prev) => prev.filter((p) => p.id !== id));

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
            Where Transformer Lab runs training & inference jobs — local machine or remote
            providers (RunPod, AWS, SkyPilot, …).
          </p>
        </div>
        <Button type="button" className="shrink-0" onClick={() => setIsAddOpen(true)}>
          <Plus className="size-4" />
          Add provider
        </Button>
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

      <div className="space-y-3">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            onSetDefault={() => setDefault(provider.id)}
            onRemove={() => removeProvider(provider.id)}
          />
        ))}
      </div>

      <AddProviderSheet open={isAddOpen} onClose={() => setIsAddOpen(false)} onAdd={addProvider} />
    </div>
  );
}

function ProviderCard({
  provider,
  onSetDefault,
  onRemove,
}: {
  provider: ComputeProvider;
  onSetDefault: () => void;
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
          {!provider.isDefault ? (
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={onSetDefault}>
              Set default
            </Button>
          ) : null}
          {provider.type !== "Local" ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove} title="Remove provider">
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {provider.accelerators.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-[12px] font-medium text-ink">Detected accelerators</p>
          <div className="flex flex-wrap gap-2">
            {provider.accelerators.map((a, i) => (
              <span
                key={`${provider.id}-acc-${i}`}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink"
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
          <p className="text-[12px] font-medium text-ink">Clusters</p>
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
        <span className="text-[12px] text-ink-soft">
          {cluster.numNodes} node{cluster.numNodes > 1 ? "s" : ""}
          {running > 0 ? ` · ${running} running` : ""}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-ink-soft">{cluster.resourcesStr}</p>
    </div>
  );
}
