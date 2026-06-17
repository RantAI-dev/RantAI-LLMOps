import {
  DEFAULT_RAG_INDEX_CONFIG,
  mockChunkFromDocument,
} from "@/modules/datasets/data/rag-mock-data";
import type {
  CreateDatasetInput,
  Dataset,
  RagDocument,
  RagIndexConfig,
  RagKnowledgeBase,
  RagQueryResult,
} from "@/modules/datasets/types";
import { MOCK_RAG_QUERY_RESPONSES } from "@/modules/datasets/data/rag-mock-data";

export function createDefaultRagKnowledgeBase(): RagKnowledgeBase {
  return {
    indexStatus: "Not Indexed",
    indexConfig: { ...DEFAULT_RAG_INDEX_CONFIG },
    documents: [],
    chunks: [],
    totalChunks: 0,
    lastIndexedAt: null,
    qaPairCount: 0,
  };
}

export function ensureRagKnowledgeBase(dataset: Dataset): Dataset {
  if (dataset.datasetType !== "RAG Knowledge Base") return dataset;
  if (dataset.rag) return dataset;
  return { ...dataset, rag: createDefaultRagKnowledgeBase() };
}

export function mergeRagDefaults(datasets: Dataset[]): Dataset[] {
  return datasets.map(ensureRagKnowledgeBase);
}

export function applyRagToNewDataset(input: CreateDatasetInput): RagKnowledgeBase | null {
  if (input.datasetType !== "RAG Knowledge Base") return null;
  return createDefaultRagKnowledgeBase();
}

export function estimateChunkCount(doc: RagDocument, config: RagIndexConfig): number {
  const avgBytesPerChunk = config.chunkSize * 4;
  return Math.max(1, Math.ceil(doc.sizeBytes / avgBytesPerChunk));
}

export function buildIndexChunks(
  documents: RagDocument[],
  config: RagIndexConfig
): { chunks: RagKnowledgeBase["chunks"]; totalChunks: number } {
  const chunks = documents.flatMap((doc) => {
    const count = estimateChunkCount(doc, config);
    return Array.from({ length: Math.min(count, 3) }, (_, i) => mockChunkFromDocument(doc, i));
  });
  const totalChunks = documents.reduce(
    (sum, doc) => sum + estimateChunkCount(doc, config),
    0
  );
  return { chunks, totalChunks };
}

export function queryRagKnowledgeBase(
  rag: RagKnowledgeBase,
  query: string
): { answer: string; results: RagQueryResult[] } {
  const q = query.toLowerCase();
  let match = MOCK_RAG_QUERY_RESPONSES.default!;
  if (q.includes("transfer") || q.includes("stock")) {
    match = MOCK_RAG_QUERY_RESPONSES["stock transfer"]!;
  } else if (q.includes("cycle") || q.includes("count")) {
    match = MOCK_RAG_QUERY_RESPONSES["cycle count"]!;
  } else if (q.includes("receiv") || q.includes("inbound") || q.includes("dock")) {
    match = MOCK_RAG_QUERY_RESPONSES.receiving!;
  }

  const results: RagQueryResult[] = match.chunkIds
    .map((id, i) => {
      const chunk = rag.chunks.find((c) => c.id === id);
      if (!chunk) return null;
      return { chunk, score: 0.92 - i * 0.08 };
    })
    .filter((r): r is RagQueryResult => r !== null);

  const fallbackChunks = rag.chunks.slice(0, 2).map((chunk, i) => ({
    chunk,
    score: 0.75 - i * 0.1,
  }));

  return {
    answer: match.answer,
    results: results.length > 0 ? results : fallbackChunks,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateRagDocumentId(): string {
  return `rag-doc-${Date.now().toString(36)}`;
}
