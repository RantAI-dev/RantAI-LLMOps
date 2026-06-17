import type {
  RagChunk,
  RagDocument,
  RagEvalRun,
  RagIndexConfig,
  RagKnowledgeBase,
} from "@/modules/datasets/types";

export const DEFAULT_RAG_INDEX_CONFIG: RagIndexConfig = {
  embeddingModelId: "model-003",
  embeddingModelName: "BGE Large Embedding",
  chunkSize: 512,
  chunkOverlap: 64,
  vectorStore: "Chroma",
  folder: "rag",
};

const WMS_DOCUMENTS: RagDocument[] = [
  {
    id: "rag-doc-1",
    name: "wms-faq-overview.md",
    type: "Markdown",
    sizeBytes: 48_200,
    uploadedAt: "2026-05-01T09:15:00.000Z",
    uploadedBy: "Admin-NQR",
    status: "Indexed",
    chunkCount: 42,
    folder: "rag",
  },
  {
    id: "rag-doc-2",
    name: "warehouse-sop-handling.pdf",
    type: "PDF",
    sizeBytes: 1_240_000,
    uploadedAt: "2026-05-05T12:00:00.000Z",
    uploadedBy: "Admin-NQR",
    status: "Indexed",
    chunkCount: 186,
    folder: "rag",
  },
  {
    id: "rag-doc-3",
    name: "inventory-cycle-count.txt",
    type: "Text",
    sizeBytes: 22_400,
    uploadedAt: "2026-05-21T10:30:00.000Z",
    uploadedBy: "Admin-NQR",
    status: "Indexed",
    chunkCount: 28,
    folder: "rag",
  },
];

const WMS_CHUNKS: RagChunk[] = [
  {
    id: "chunk-1",
    documentId: "rag-doc-1",
    documentName: "wms-faq-overview.md",
    content:
      "Q: How do I initiate a stock transfer between warehouses? A: Navigate to Inventory > Transfers, select source and destination warehouse, scan items, and submit for approval.",
    tokenCount: 38,
    chunkIndex: 0,
  },
  {
    id: "chunk-2",
    documentId: "rag-doc-1",
    documentName: "wms-faq-overview.md",
    content:
      "Q: What is the standard pick path optimization? A: The WMS uses zone-based picking with wave planning. Enable wave picking in Settings > Fulfillment > Pick Strategy.",
    tokenCount: 35,
    chunkIndex: 1,
  },
  {
    id: "chunk-3",
    documentId: "rag-doc-2",
    documentName: "warehouse-sop-handling.pdf",
    content:
      "Section 4.2 — Receiving Inspection: All inbound shipments must be inspected within 2 hours of dock arrival. Document discrepancies in the Receiving Exception module.",
    tokenCount: 32,
    chunkIndex: 0,
  },
  {
    id: "chunk-4",
    documentId: "rag-doc-2",
    documentName: "warehouse-sop-handling.pdf",
    content:
      "Section 7.1 — Cycle Count Procedures: Perform ABC cycle counts weekly for A-items, bi-weekly for B-items, and monthly for C-items. Variance above 2% triggers recount.",
    tokenCount: 36,
    chunkIndex: 1,
  },
  {
    id: "chunk-5",
    documentId: "rag-doc-3",
    documentName: "inventory-cycle-count.txt",
    content:
      "Blind count mode hides expected quantities from operators to reduce bias. Enable blind count in Cycle Count Settings before starting a count session.",
    tokenCount: 28,
    chunkIndex: 0,
  },
];

export const WMS_RAG_KNOWLEDGE_BASE: RagKnowledgeBase = {
  indexStatus: "Ready",
  indexConfig: DEFAULT_RAG_INDEX_CONFIG,
  documents: WMS_DOCUMENTS,
  chunks: WMS_CHUNKS,
  totalChunks: 256,
  lastIndexedAt: "2026-05-21T11:30:00.000Z",
  qaPairCount: 20,
};

export const MOCK_RAG_QUERY_RESPONSES: Record<string, { answer: string; chunkIds: string[] }> = {
  "stock transfer": {
    answer:
      "To initiate a stock transfer, go to Inventory > Transfers, select source and destination warehouses, scan items, and submit for approval.",
    chunkIds: ["chunk-1"],
  },
  "cycle count": {
    answer:
      "Cycle counts follow ABC classification: A-items weekly, B-items bi-weekly, C-items monthly. Variance above 2% triggers a recount. Blind count mode is recommended.",
    chunkIds: ["chunk-4", "chunk-5"],
  },
  receiving: {
    answer:
      "All inbound shipments must be inspected within 2 hours of dock arrival. Document any discrepancies in the Receiving Exception module.",
    chunkIds: ["chunk-3"],
  },
  default: {
    answer:
      "Based on the WMS knowledge base, please refer to the relevant SOP or FAQ section. Try asking about stock transfers, cycle counts, or receiving procedures.",
    chunkIds: ["chunk-1"],
  },
};

export const MOCK_RAG_EVAL_RUNS: RagEvalRun[] = [
  {
    id: "rag-eval-1",
    name: "WMS Support — Standard retrieval",
    knowledgeBaseId: "ds-wms-faq",
    knowledgeBaseName: "WMS FAQ Knowledge Base",
    embeddingModel: "BAAI/bge-base-en-v1.5",
    status: "Completed",
    completedAt: "2026-05-22T14:00:00.000Z",
    taskId: "task-rag-eval-baseline",
    metrics: [
      {
        id: "ctx-precision",
        name: "Contextual Precision",
        baseline: 0.72,
        fineTuned: 0.72,
        unit: "score",
        description: "How often the right passages are retrieved for each question",
      },
      {
        id: "answer-relevancy",
        name: "Answer Relevancy",
        baseline: 0.68,
        fineTuned: 0.68,
        unit: "score",
        description: "How well answers address the original question",
      },
      {
        id: "faithfulness",
        name: "Faithfulness",
        baseline: 0.81,
        fineTuned: 0.81,
        unit: "score",
        description: "How closely answers follow the retrieved source material",
      },
    ],
  },
  {
    id: "rag-eval-2",
    name: "WMS Support — Tuned retrieval",
    knowledgeBaseId: "ds-wms-faq",
    knowledgeBaseName: "WMS FAQ Knowledge Base",
    embeddingModel: "BAAI/bge-base-en-v1.5 (fine-tuned)",
    status: "Completed",
    completedAt: "2026-05-23T09:30:00.000Z",
    taskId: "task-rag-eval-finetuned",
    metrics: [
      {
        id: "ctx-precision",
        name: "Contextual Precision",
        baseline: 0.72,
        fineTuned: 0.89,
        unit: "score",
        description: "How often the right passages are retrieved for each question",
      },
      {
        id: "answer-relevancy",
        name: "Answer Relevancy",
        baseline: 0.68,
        fineTuned: 0.85,
        unit: "score",
        description: "How well answers address the original question",
      },
      {
        id: "faithfulness",
        name: "Faithfulness",
        baseline: 0.81,
        fineTuned: 0.92,
        unit: "score",
        description: "How closely answers follow the retrieved source material",
      },
    ],
  },
];

export function inferDocumentType(filename: string): RagDocument["type"] {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "PDF";
    case "md":
    case "markdown":
      return "Markdown";
    case "docx":
      return "DOCX";
    case "html":
    case "htm":
      return "HTML";
    default:
      return "Text";
  }
}

export function mockChunkFromDocument(doc: RagDocument, index: number): RagChunk {
  return {
    id: `chunk-${doc.id}-${index}`,
    documentId: doc.id,
    documentName: doc.name,
    content: `[Passage ${index + 1} from ${doc.name}] Content will appear here after indexing completes.`,
    tokenCount: 32 + index * 4,
    chunkIndex: index,
  };
}
