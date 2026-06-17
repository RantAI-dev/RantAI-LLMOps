"use client";

import { FlaskConical, MessageSquareMore, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";

import { BreadcrumbNav } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RagChunksTab } from "@/modules/datasets/components/rag/rag-chunks-tab";
import { RagDocumentsTab } from "@/modules/datasets/components/rag/rag-documents-tab";
import { RagIndexTab } from "@/modules/datasets/components/rag/rag-index-tab";
import { RAG_INDEX_STATUS_STYLES, datasetUi } from "@/modules/datasets/constants/dataset-ui";
import type { Dataset, RagIndexConfig } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type DocumentKbDetailViewProps = {
  dataset: Dataset;
  onBack: () => void;
  onUpload: () => void;
  onUploadFiles: (fileName: string, sizeBytes: number) => void;
  onRemoveDocument: (documentId: string) => void;
  onUpdateIndexConfig: (config: Partial<RagIndexConfig>) => void;
  onReindex: () => Promise<void>;
  onOpenInteract?: () => void;
  onOpenEvals?: () => void;
};

export function DocumentKbDetailView({
  dataset,
  onBack,
  onUpload,
  onUploadFiles,
  onRemoveDocument,
  onUpdateIndexConfig,
  onReindex,
  onOpenInteract,
  onOpenEvals,
}: DocumentKbDetailViewProps) {
  const [activeTab, setActiveTab] = useState("documents");
  const [isIndexing, setIsIndexing] = useState(false);
  const rag = dataset.rag;
  const indexStatus = rag?.indexStatus ?? "Not Indexed";
  const statusStyle = RAG_INDEX_STATUS_STYLES[indexStatus] ?? RAG_INDEX_STATUS_STYLES["Not Indexed"]!;

  const handleReindex = () => {
    setIsIndexing(true);
    void onReindex().finally(() => setIsIndexing(false));
  };

  return (
    <article className="min-w-0 w-full space-y-4">
      <header className="space-y-3 border-b border-hairline pb-4">
        <BreadcrumbNav
          items={[
            { label: "Documents", onClick: onBack },
            { label: dataset.name },
          ]}
        />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  statusStyle.bg,
                  statusStyle.text
                )}
              >
                {indexStatus}
              </span>
              <h1 className={datasetUi.detailTitle}>{dataset.name}</h1>
            </div>
            <p className="mt-1 max-w-2xl text-[14px] text-ink-soft">{dataset.description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onUpload}>
              <Upload className="size-3.5" />
              Upload
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!rag?.documents.length || indexStatus === "Indexing" || isIndexing}
              onClick={handleReindex}
            >
              <RefreshCw className="size-3.5" />
              {isIndexing ? "Indexing…" : "Index all"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={indexStatus !== "Ready"}
              onClick={onOpenInteract}
            >
              <MessageSquareMore className="size-3.5" />
              Ask in Interact
            </Button>
            <Button type="button" size="sm" disabled={indexStatus !== "Ready"} onClick={onOpenEvals}>
              <FlaskConical className="size-3.5" />
              Run evaluation
            </Button>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
          <TabsTrigger value="documents" className="text-[13px]">
            Documents
          </TabsTrigger>
          <TabsTrigger value="search-settings" className="text-[13px]">
            Search settings
          </TabsTrigger>
          <TabsTrigger value="passages" className="text-[13px]">
            Passages
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-4">
          <RagDocumentsTab
            dataset={dataset}
            onUpload={onUploadFiles}
            onRemove={onRemoveDocument}
            onReindex={handleReindex}
            isIndexing={isIndexing}
          />
        </TabsContent>
        <TabsContent value="search-settings" className="mt-4">
          <RagIndexTab dataset={dataset} onSave={onUpdateIndexConfig} onReindex={handleReindex} />
        </TabsContent>
        <TabsContent value="passages" className="mt-4">
          <RagChunksTab dataset={dataset} />
        </TabsContent>
      </Tabs>
    </article>
  );
}
