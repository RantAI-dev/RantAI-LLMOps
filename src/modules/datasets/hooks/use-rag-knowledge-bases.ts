"use client";

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import { generateActivityId, updateDataset } from "@/modules/datasets/lib/utils";
import { buildReadiness } from "@/modules/datasets/lib/utils";
import {
  buildIndexChunks,
  generateRagDocumentId,
  queryRagKnowledgeBase,
} from "@/modules/datasets/lib/rag-utils";
import { inferDocumentType } from "@/modules/datasets/data/rag-mock-data";
import type { Dataset, RagIndexConfig } from "@/modules/datasets/types";

/**
 * The RAG knowledge-base slice of the datasets domain: deriving which datasets
 * are knowledge bases, and the document/index/query actions over them. Extracted
 * from `DatasetsProvider` so the provider keeps dataset CRUD only; this owns the
 * RAG concern. Operates on the shared `datasets` state via `setDatasets`.
 *
 * NOTE: there is no Transformer Lab backend for embeddings/vector store yet, so
 * indexing/query are mock — see `feature-status.ts` (`rag.*` = "mock").
 */
export function useRagKnowledgeBases(
  datasets: Dataset[],
  setDatasets: Dispatch<SetStateAction<Dataset[]>>
) {
  const ragKnowledgeBases = useMemo(
    () =>
      datasets.filter(
        (d) => d.datasetType === "RAG Knowledge Base" && d.validationStatus !== "Archived"
      ),
    [datasets]
  );

  const uploadRagDocument = useCallback(
    (datasetId: string, fileName: string, sizeBytes: number) => {
      const now = new Date().toISOString();
      const doc = {
        id: generateRagDocumentId(),
        name: fileName,
        type: inferDocumentType(fileName),
        sizeBytes,
        uploadedAt: now,
        uploadedBy: "Admin-NQR",
        status: "Pending" as const,
        chunkCount: 0,
        folder: "rag",
      };

      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => {
          if (!d.rag) return d;
          return {
            ...d,
            lastUpdated: now,
            rag: {
              ...d.rag,
              indexStatus: "Stale",
              documents: [doc, ...d.rag.documents],
            },
            activityLog: [
              {
                id: generateActivityId(),
                timestamp: now,
                actor: "Admin-NQR",
                activity: "Document uploaded",
                description: `${fileName} added to knowledge base`,
              },
              ...d.activityLog,
            ],
          };
        })
      );
    },
    [setDatasets]
  );

  const removeRagDocument = useCallback(
    (datasetId: string, documentId: string) => {
      const now = new Date().toISOString();
      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => {
          if (!d.rag) return d;
          const removed = d.rag.documents.find((doc) => doc.id === documentId);
          return {
            ...d,
            lastUpdated: now,
            rag: {
              ...d.rag,
              indexStatus: "Stale",
              documents: d.rag.documents.filter((doc) => doc.id !== documentId),
              chunks: d.rag.chunks.filter((c) => c.documentId !== documentId),
            },
            activityLog: [
              {
                id: generateActivityId(),
                timestamp: now,
                actor: "Admin-NQR",
                activity: "Document removed",
                description: removed ? `${removed.name} removed from knowledge base` : "Document removed",
              },
              ...d.activityLog,
            ],
          };
        })
      );
    },
    [setDatasets]
  );

  const updateRagIndexConfig = useCallback(
    (datasetId: string, config: Partial<RagIndexConfig>) => {
      const now = new Date().toISOString();
      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => {
          if (!d.rag) return d;
          return {
            ...d,
            lastUpdated: now,
            rag: {
              ...d.rag,
              indexStatus: d.rag.indexStatus === "Ready" ? "Stale" : d.rag.indexStatus,
              indexConfig: { ...d.rag.indexConfig, ...config },
            },
            activityLog: [
              {
                id: generateActivityId(),
                timestamp: now,
                actor: "Admin-NQR",
                activity: "Search settings updated",
                description: "Indexing configuration saved",
              },
              ...d.activityLog,
            ],
          };
        })
      );
    },
    [setDatasets]
  );

  const reindexRagKnowledgeBase = useCallback(
    async (datasetId: string) => {
      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) =>
          d.rag ? { ...d, rag: { ...d.rag, indexStatus: "Indexing" } } : d
        )
      );

      await new Promise((r) => setTimeout(r, 2000));

      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => {
          if (!d.rag) return d;
          const indexedDocs = d.rag.documents.map((doc) => ({
            ...doc,
            status: "Indexed" as const,
            chunkCount: Math.max(1, Math.ceil(doc.sizeBytes / (d.rag!.indexConfig.chunkSize * 4))),
          }));
          const { chunks, totalChunks } = buildIndexChunks(indexedDocs, d.rag.indexConfig);
          const finished = new Date().toISOString();
          return {
            ...d,
            lastUpdated: finished,
            readiness: buildReadiness(d),
            rag: {
              ...d.rag,
              indexStatus: "Ready",
              documents: indexedDocs,
              chunks,
              totalChunks,
              lastIndexedAt: finished,
            },
            activityLog: [
              {
                id: generateActivityId(),
                timestamp: finished,
                actor: "System",
                activity: "Index rebuilt",
                description: `${totalChunks} passages indexed and ready for search`,
              },
              ...d.activityLog,
            ],
          };
        })
      );
    },
    [setDatasets]
  );

  const queryRag = useCallback(
    (datasetId: string, query: string) => {
      const dataset = datasets.find((d) => d.id === datasetId);
      if (!dataset?.rag || dataset.rag.indexStatus !== "Ready") return null;
      return queryRagKnowledgeBase(dataset.rag, query);
    },
    [datasets]
  );

  return useMemo(
    () => ({
      ragKnowledgeBases,
      uploadRagDocument,
      removeRagDocument,
      updateRagIndexConfig,
      reindexRagKnowledgeBase,
      queryRag,
    }),
    [
      ragKnowledgeBases,
      uploadRagDocument,
      removeRagDocument,
      updateRagIndexConfig,
      reindexRagKnowledgeBase,
      queryRag,
    ]
  );
}
