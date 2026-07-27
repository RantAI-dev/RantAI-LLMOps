"use client";

import { Compass } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoTip } from "@/components/ui/tooltip";
import { textUi } from "@/lib/text-ui";
import { HubDatasets } from "@/modules/hub/components/hub-datasets";
import { HubModels } from "@/modules/hub/components/hub-models";

export function HubPage() {
  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="border-b border-border pb-4">
        <div className="flex items-center gap-1.5">
          <h1 className={`${textUi.title} flex items-center gap-2 text-primary`}>
            <Compass className="size-6" aria-hidden /> Hub
          </h1>
          <InfoTip label="About the Hub">
            Search and download models from Hugging Face. By default this shows{" "}
            <span className="font-medium">GGUF</span> models (chat-ready via Ollama); enable{" "}
            <span className="font-medium">“Include safetensors”</span> to also see fine-tune base
            models. You can also find datasets for fine-tuning.
          </InfoTip>
        </div>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
          Temukan model dan dataset dari Hugging Face. Download model GGUF untuk chat lewat Ollama,
          atau pilih base model dan dataset untuk fine-tune.
        </p>
      </div>

      <Tabs defaultValue="models">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
        </TabsList>
        <TabsContent value="models" className="mt-2">
          <HubModels />
        </TabsContent>
        <TabsContent value="datasets" className="mt-2">
          <HubDatasets />
        </TabsContent>
      </Tabs>
    </div>
  );
}
