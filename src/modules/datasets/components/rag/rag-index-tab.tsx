"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MockBanner } from "@/components/ui/mock-banner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RAG_INDEX_STATUS_STYLES,
  panelClassName,
} from "@/modules/datasets/constants/dataset-ui";
import type { Dataset, RagIndexConfig, RagVectorStore } from "@/modules/datasets/types";
import { RAG_VECTOR_STORES } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

const EMBEDDING_MODELS = [
  { id: "model-003", name: "BGE Large Embedding", repo: "BAAI/bge-large-en-v1.5" },
  { id: "model-bge-base", name: "BGE Base Embedding", repo: "BAAI/bge-base-en-v1.5" },
  { id: "model-e5", name: "E5 Large v2", repo: "intfloat/e5-large-v2" },
];

type RagIndexTabProps = {
  dataset: Dataset;
  onSave: (config: Partial<RagIndexConfig>) => void;
  onReindex: () => void;
};

export function RagIndexTab({ dataset, onSave, onReindex }: RagIndexTabProps) {
  const rag = dataset.rag;
  const [config, setConfig] = useState<RagIndexConfig | null>(rag?.indexConfig ?? null);

  if (!rag || !config) return null;

  const statusStyle = RAG_INDEX_STATUS_STYLES[rag.indexStatus] ?? RAG_INDEX_STATUS_STYLES["Not Indexed"]!;

  return (
    <div className="space-y-4">
      <MockBanner>
        Embedding, chunking, dan vector store (Chroma/FAISS/Qdrant) belum ada di backend
        Transformer Lab — pengaturan & status indeks di bawah masih contoh (mock).
      </MockBanner>
      <div className={cn(panelClassName, "p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-primary">Index Status</h3>
          <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", statusStyle.bg, statusStyle.text)}>
            {rag.indexStatus}
          </span>
        </div>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Total Chunks", String(rag.totalChunks)],
            ["Documents", String(rag.documents.length)],
            ["Vector Store", rag.indexConfig.vectorStore],
            ["Embedding Model", rag.indexConfig.embeddingModelName],
          ].map(([k, v]) => (
            <div key={k} className="text-[13px]">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className={cn(panelClassName, "space-y-4 p-4")}>
        <h3 className="text-[14px] font-semibold text-primary">Search index settings</h3>
        <p className="text-[13px] text-ink-soft">
          Control how documents are split and embedded so retrieval matches your content and use case.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Embedding Model">
            <Select
              items={EMBEDDING_MODELS.map((m) => ({ value: m.id, label: `${m.name} (${m.repo})` }))}
              value={config.embeddingModelId}
              onValueChange={(next) => {
                const model = EMBEDDING_MODELS.find((m) => m.id === next);
                if (model) {
                  setConfig((c) =>
                    c ? { ...c, embeddingModelId: model.id, embeddingModelName: model.name } : c
                  );
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMBEDDING_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.repo})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Vector Store">
            <Select
              value={config.vectorStore}
              onValueChange={(next) =>
                next && setConfig((c) => (c ? { ...c, vectorStore: next as RagVectorStore } : c))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RAG_VECTOR_STORES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Passage size (tokens)">
            <Input
              type="number"
              min={128}
              max={2048}
              value={config.chunkSize}
              onChange={(e) =>
                setConfig((c) => (c ? { ...c, chunkSize: Number(e.target.value) } : c))
              }
            />
          </Field>

          <Field label="Passage overlap (tokens)">
            <Input
              type="number"
              min={0}
              max={512}
              value={config.chunkOverlap}
              onChange={(e) =>
                setConfig((c) => (c ? { ...c, chunkOverlap: Number(e.target.value) } : c))
              }
            />
          </Field>

          <Field label="Document folder">
            <Input
              value={config.folder}
              onChange={(e) => setConfig((c) => (c ? { ...c, folder: e.target.value } : c))}
              placeholder="rag"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => onSave(config)}>
            Save settings
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rag.documents.length === 0 || rag.indexStatus === "Indexing"}
            onClick={onReindex}
          >
            Rebuild search index
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
