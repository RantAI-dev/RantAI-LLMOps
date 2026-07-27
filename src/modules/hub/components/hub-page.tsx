"use client";

import { useState } from "react";
import { Compass } from "lucide-react";

import { HubDatasets } from "@/modules/hub/components/hub-datasets";
import { HubDownloaded } from "@/modules/hub/components/hub-downloaded";
import { HubModels } from "@/modules/hub/components/hub-models";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HubPage() {
  const [tab, setTab] = useState<"models" | "datasets" | "downloaded">("models");

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="border-b border-border pb-4">
        <div className="flex items-center gap-1.5">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
            <Compass className="size-5" /> Hub
          </h1>
          <InfoTip label="About the Hub">
            Search and download models from Hugging Face. By default this shows{" "}
            <span className="font-medium">GGUF</span> models (chat-ready via Ollama); enable{" "}
            <span className="font-medium">“Include safetensors”</span> to also see fine-tune base
            models. You can also find datasets for fine-tuning.
          </InfoTip>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === "models"} onClick={() => setTab("models")}>
          Models
        </TabButton>
        <TabButton active={tab === "datasets"} onClick={() => setTab("datasets")}>
          Datasets
        </TabButton>
        <TabButton active={tab === "downloaded"} onClick={() => setTab("downloaded")}>
          Downloaded
        </TabButton>
      </div>

      {tab === "models" ? <HubModels /> : tab === "datasets" ? <HubDatasets /> : <HubDownloaded />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary text-primary"
          : "border-transparent text-ink-soft hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}
