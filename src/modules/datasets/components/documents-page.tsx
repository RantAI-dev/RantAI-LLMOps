"use client";

import {
  Database,
  FileText,
  FolderOpen,
  MessageSquareMore,
  Plus,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateDatasetWizard } from "@/modules/datasets/components/create-dataset-wizard";
import { DocumentKbDetailView } from "@/modules/datasets/components/document-kb-detail-view";
import { DocumentsFiltersBar } from "@/modules/datasets/components/documents-filters";
import { DocumentsSummaryCards } from "@/modules/datasets/components/documents-summary-cards";
import { DocumentsTable } from "@/modules/datasets/components/documents-table";
import { UploadDocumentSheet } from "@/modules/datasets/components/upload-document-sheet";
import {
  defaultDocumentsFilters,
  documentsUi,
  type DocumentsFilters,
} from "@/modules/datasets/constants/documents-ui";
import { RAG_INDEX_STATUS_STYLES, panelClassName } from "@/modules/datasets/constants/dataset-ui";
import { useDatasets } from "@/modules/datasets/hooks/use-datasets";
import {
  computeDocumentsSummary,
  filterDocuments,
  flattenDocuments,
} from "@/modules/datasets/lib/documents-utils";
import { formatDateTime } from "@/modules/datasets/lib/utils";
import type { Dataset } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type DocumentsPageProps = {
  onNavigate?: (menu: "Interact" | "Evals" | "Dataset", knowledgeBaseId?: string) => void;
};

export function DocumentsPage({ onNavigate }: DocumentsPageProps) {
  const {
    ragKnowledgeBases,
    getDatasetById,
    uploadRagDocument,
    removeRagDocument,
    updateRagIndexConfig,
    reindexRagKnowledgeBase,
    createDataset,
  } = useDatasets();

  const [filters, setFilters] = useState<DocumentsFilters>(defaultDocumentsFilters);
  const [listTab, setListTab] = useState<"all-documents" | "knowledge-bases">("all-documents");
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadKbPreset, setUploadKbPreset] = useState<string | undefined>();
  const [isCreateKbOpen, setIsCreateKbOpen] = useState(false);

  const summary = useMemo(() => computeDocumentsSummary(ragKnowledgeBases), [ragKnowledgeBases]);
  const allDocuments = useMemo(() => flattenDocuments(ragKnowledgeBases), [ragKnowledgeBases]);
  const filteredDocuments = useMemo(
    () => filterDocuments(allDocuments, filters),
    [allDocuments, filters]
  );

  const selectedKb = selectedKbId ? getDatasetById(selectedKbId) : null;

  const openUpload = (knowledgeBaseId?: string) => {
    setUploadKbPreset(knowledgeBaseId);
    setIsUploadOpen(true);
  };

  const handleUpload = async (
    knowledgeBaseId: string,
    files: File[],
    indexAfterUpload: boolean
  ) => {
    files.forEach((file) => uploadRagDocument(knowledgeBaseId, file.name, file.size));
    if (indexAfterUpload) {
      await reindexRagKnowledgeBase(knowledgeBaseId);
    }
  };

  if (selectedKb?.rag) {
    return (
      <>
        <DocumentKbDetailView
          dataset={selectedKb}
          onBack={() => setSelectedKbId(null)}
          onUpload={() => openUpload(selectedKb.id)}
          onUploadFiles={(fileName, sizeBytes) =>
            uploadRagDocument(selectedKb.id, fileName, sizeBytes)
          }
          onRemoveDocument={(documentId) => removeRagDocument(selectedKb.id, documentId)}
          onUpdateIndexConfig={(config) => updateRagIndexConfig(selectedKb.id, config)}
          onReindex={() => reindexRagKnowledgeBase(selectedKb.id)}
          onOpenInteract={() => onNavigate?.("Interact", selectedKb.id)}
          onOpenEvals={() => onNavigate?.("Evals", selectedKb.id)}
        />
        <UploadDocumentSheet
          open={isUploadOpen}
          knowledgeBases={ragKnowledgeBases}
          defaultKnowledgeBaseId={selectedKb.id}
          onClose={() => setIsUploadOpen(false)}
          onUpload={handleUpload}
        />
      </>
    );
  }

  const showEmpty = ragKnowledgeBases.length === 0;
  const showFilteredEmpty = !showEmpty && filteredDocuments.length === 0 && listTab === "all-documents";

  return (
    <>
      <div className="min-w-0 w-full space-y-4">
        <div className="flex flex-col gap-4 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className={cn("text-primary", documentsUi.title)}>Documents</h1>
            <p className={cn("mt-1 max-w-2xl", documentsUi.subheading)}>
              Upload, organize, and index source files for your knowledge bases. Ready content
              powers Q&amp;A in Interact and quality measurement in Evals.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={ragKnowledgeBases.length === 0}
              onClick={() => openUpload()}
            >
              <Upload className="size-4" />
              Upload documents
            </Button>
            <Button type="button" onClick={() => setIsCreateKbOpen(true)}>
              <Plus className="size-4" />
              New knowledge base
            </Button>
          </div>
        </div>

        {!showEmpty ? (
          <>
            <DocumentsSummaryCards summary={summary} />
            <DocumentsFiltersBar
              filters={filters}
              knowledgeBases={ragKnowledgeBases}
              onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
              onReset={() => setFilters(defaultDocumentsFilters)}
            />
          </>
        ) : null}

        {showEmpty ? (
          <EmptyState onCreate={() => setIsCreateKbOpen(true)} />
        ) : (
          <Tabs value={listTab} onValueChange={(v) => setListTab(v as typeof listTab)}>
            <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
              <TabsTrigger value="all-documents" className="text-[13px]">
                All documents
                <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[11px] tabular-nums text-ink-soft">
                  {allDocuments.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="knowledge-bases" className="text-[13px]">
                Knowledge bases
                <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[11px] tabular-nums text-ink-soft">
                  {ragKnowledgeBases.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all-documents" className="mt-4">
              {showFilteredEmpty ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
                  <p className="text-sm text-ink-soft">No documents match your filters.</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
                    onClick={() => setFilters(defaultDocumentsFilters)}
                  >
                    Reset filters
                  </Button>
                </div>
              ) : (
                <DocumentsTable
                  items={filteredDocuments}
                  onOpenKnowledgeBase={setSelectedKbId}
                  onRemove={(kbId, docId) => removeRagDocument(kbId, docId)}
                />
              )}
            </TabsContent>

            <TabsContent value="knowledge-bases" className="mt-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {ragKnowledgeBases.map((kb) => (
                  <KnowledgeBaseCard
                    key={kb.id}
                    knowledgeBase={kb}
                    onOpen={() => setSelectedKbId(kb.id)}
                    onUpload={() => openUpload(kb.id)}
                    onOpenInteract={() => onNavigate?.("Interact", kb.id)}
                  />
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <UploadDocumentSheet
        open={isUploadOpen}
        knowledgeBases={ragKnowledgeBases}
        defaultKnowledgeBaseId={uploadKbPreset}
        onClose={() => {
          setIsUploadOpen(false);
          setUploadKbPreset(undefined);
        }}
        onUpload={handleUpload}
      />

      <CreateDatasetWizard
        key={isCreateKbOpen ? "create-kb-open" : "create-kb-closed"}
        open={isCreateKbOpen}
        onClose={() => setIsCreateKbOpen(false)}
        onSave={(input) => {
          const id = createDataset(input);
          setIsCreateKbOpen(false);
          setSelectedKbId(id);
          return id;
        }}
        preset={{
          datasetType: "RAG Knowledge Base",
          source: "File Upload",
          name: "New Knowledge Base",
          description: "Source documents for document Q&A and evaluation.",
        }}
      />
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <FolderOpen className="size-10 text-primary/60" />
      <h2 className="mt-4 text-lg font-semibold text-primary">Start your document library</h2>
      <p className="mt-2 max-w-md text-sm text-ink-soft">
        Create a knowledge base, upload your files, and index them so your team can ask questions
        with confidence.
      </p>
      <Button type="button" className="mt-4" onClick={onCreate}>
        Create knowledge base
      </Button>
    </div>
  );
}

function KnowledgeBaseCard({
  knowledgeBase: kb,
  onOpen,
  onUpload,
  onOpenInteract,
}: {
  knowledgeBase: Dataset;
  onOpen: () => void;
  onUpload: () => void;
  onOpenInteract: () => void;
}) {
  const rag = kb.rag;
  const status = rag?.indexStatus ?? "Not Indexed";
  const style = RAG_INDEX_STATUS_STYLES[status] ?? RAG_INDEX_STATUS_STYLES["Not Indexed"]!;

  return (
    <div className={cn(panelClassName, "flex flex-col gap-3 p-4")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="size-4 shrink-0 text-primary" />
            <h2 className="truncate font-semibold text-ink">{kb.name}</h2>
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] text-ink-soft">{kb.description}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            style.bg,
            style.text
          )}
        >
          {status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <MiniStat label="Documents" value={String(rag?.documents.length ?? 0)} />
        <MiniStat label="Passages" value={String(rag?.totalChunks ?? 0)} />
        <MiniStat label="Q&A pairs" value={String(rag?.qaPairCount ?? 0)} />
      </div>

      {rag?.documents.slice(0, 2).map((doc) => (
        <div key={doc.id} className="flex items-center gap-2 text-xs text-ink-soft">
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate">{doc.name}</span>
        </div>
      ))}

      <p className="text-[11px] text-ink-faint">
        Last indexed: {rag?.lastIndexedAt ? formatDateTime(rag.lastIndexedAt) : "Not yet indexed"}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" size="sm" onClick={onOpen}>
          Manage
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onUpload}>
          Upload
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={status !== "Ready"}
          onClick={onOpenInteract}
        >
          <MessageSquareMore className="size-3.5" />
          Interact
        </Button>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-white px-2 py-1.5">
      <p className="text-ink-faint">{label}</p>
      <p className="font-semibold tabular-nums text-primary">{value}</p>
    </div>
  );
}
