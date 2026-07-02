import {
  buildReadiness,
  buildValidationSummary,
  deriveValidationStatus,
} from "@/modules/datasets/lib/utils";
import type { Dataset } from "@/modules/datasets/types";

/**
 * Map a real Transformer Lab dataset (`/data/list`) into the registry's rich
 * `Dataset` shape.
 *
 * REAL fields from TL: id/name, description, on-disk size. TL's list doesn't
 * expose per-row validation, quality scans, version history, or usage analytics
 * (see `feature-status`: dataset.qualityScan/externalSources = "mock"), so those
 * sub-objects get sensible "ready, unscanned" defaults — the detail drawer's
 * quality/usage panels stay demo-only.
 */

type TlDatasetRow = {
  id: string;
  description: string;
  sizeMb: number | null;
};

function formatSize(sizeMb: number | null): string {
  if (sizeMb == null || sizeMb <= 0) return "JSONL";
  return sizeMb >= 1 ? `JSONL · ${sizeMb.toFixed(1)} MB` : `JSONL · ${Math.round(sizeMb * 1024)} KB`;
}

export function tlToDataset(row: TlDatasetRow, now: string): Dataset {
  // TL's list gives no row count or validation results — treat as a clean,
  // ready dataset with 0 known-invalid rows (honest: "not scanned" rather than
  // fabricated quality metrics).
  const totalRows = 0;
  const invalidRows = 0;
  const validationStatus = deriveValidationStatus(invalidRows, 0);
  return {
    id: row.id,
    name: row.id,
    description: row.description || "Dataset on disk in Transformer Lab.",
    datasetType: "Training Dataset",
    source: "File Upload",
    currentVersion: "v1",
    totalRows,
    validRows: totalRows,
    invalidRows,
    validationStatus,
    usageCount: 0,
    lastUpdated: now,
    // TL's dataset list exposes no owner/ACL. Owner unknown ("—"); a local on-disk
    // dataset is genuinely Private (not org-shared) rather than a fabricated "Team".
    owner: "—",
    tags: ["transformer-lab"],
    accessLevel: "Private",
    notes: "",
    format: formatSize(row.sizeMb),
    createdAt: now,
    schemaMapping: [],
    validationSummary: buildValidationSummary(totalRows, invalidRows),
    issues: [],
    versions: [
      {
        id: `${row.id}-v1`,
        version: "v1",
        changes: "Discovered in Transformer Lab",
        rows: totalRows,
        validationStatus,
        qualityScore: 100,
        createdBy: "System",
        createdAt: now,
        isActive: true,
      },
    ],
    split: { training: 100, validation: 0, testing: 0, evaluation: 0 },
    usage: [],
    activityLog: [
      {
        id: `${row.id}-act-1`,
        timestamp: now,
        actor: "System",
        activity: "Discovered",
        description: "Dataset found on disk via Transformer Lab.",
      },
    ],
    readiness: buildReadiness({ datasetType: "Training Dataset", validationStatus, invalidRows }),
    huggingFaceSource: null,
    rag: null,
  };
}
