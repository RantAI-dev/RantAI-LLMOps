import type { DocumentsFilters } from "@/modules/datasets/constants/documents-ui";
import type { Dataset, RagDocument, RagDocumentStatus, RagIndexStatus } from "@/modules/datasets/types";

export type DocumentListItem = {
  id: string;
  document: RagDocument;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  indexStatus: RagIndexStatus;
};

export type DocumentsSummary = {
  knowledgeBaseCount: number;
  documentCount: number;
  passageCount: number;
  readyCount: number;
  needsIndexCount: number;
};

export function flattenDocuments(knowledgeBases: Dataset[]): DocumentListItem[] {
  return knowledgeBases.flatMap((kb) =>
    (kb.rag?.documents ?? []).map((document) => ({
      id: `${kb.id}-${document.id}`,
      document,
      knowledgeBaseId: kb.id,
      knowledgeBaseName: kb.name,
      indexStatus: kb.rag?.indexStatus ?? "Not Indexed",
    }))
  );
}

export function filterDocuments(
  items: DocumentListItem[],
  filters: DocumentsFilters
): DocumentListItem[] {
  let result = [...items];
  const q = filters.search.trim().toLowerCase();

  if (q) {
    result = result.filter(
      (item) =>
        item.document.name.toLowerCase().includes(q) ||
        item.knowledgeBaseName.toLowerCase().includes(q) ||
        item.document.type.toLowerCase().includes(q)
    );
  }

  if (filters.knowledgeBase !== "all") {
    result = result.filter((item) => item.knowledgeBaseId === filters.knowledgeBase);
  }

  if (filters.documentStatus !== "all") {
    result = result.filter((item) => item.document.status === filters.documentStatus);
  }

  if (filters.indexStatus !== "all") {
    result = result.filter((item) => item.indexStatus === filters.indexStatus);
  }

  result.sort((a, b) => {
    switch (filters.sort) {
      case "name":
        return a.document.name.localeCompare(b.document.name);
      case "size":
        return b.document.sizeBytes - a.document.sizeBytes;
      case "oldest":
        return (
          new Date(a.document.uploadedAt).getTime() - new Date(b.document.uploadedAt).getTime()
        );
      case "newest":
      default:
        return (
          new Date(b.document.uploadedAt).getTime() - new Date(a.document.uploadedAt).getTime()
        );
    }
  });

  return result;
}

export function computeDocumentsSummary(knowledgeBases: Dataset[]): DocumentsSummary {
  return knowledgeBases.reduce(
    (acc, kb) => {
      const rag = kb.rag;
      const status = rag?.indexStatus ?? "Not Indexed";
      return {
        knowledgeBaseCount: acc.knowledgeBaseCount + 1,
        documentCount: acc.documentCount + (rag?.documents.length ?? 0),
        passageCount: acc.passageCount + (rag?.totalChunks ?? 0),
        readyCount: acc.readyCount + (status === "Ready" ? 1 : 0),
        needsIndexCount:
          acc.needsIndexCount +
          (status === "Not Indexed" || status === "Stale" || status === "Failed" ? 1 : 0),
      };
    },
    {
      knowledgeBaseCount: 0,
      documentCount: 0,
      passageCount: 0,
      readyCount: 0,
      needsIndexCount: 0,
    }
  );
}

export function documentStatusLabel(status: RagDocumentStatus): string {
  return status;
}

export function indexStatusLabel(status: RagIndexStatus): string {
  return status;
}
