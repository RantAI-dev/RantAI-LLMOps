import {
  buildReadiness,
  buildValidationSummary,
  deriveValidationStatus,
} from "@/modules/datasets/lib/utils";
import type { Dataset } from "@/modules/datasets/types";

/**
 * Map an imported S3 dataset reference (from the manifest) into the registry's
 * rich `Dataset` shape. The data lives in S3 (never copied to TL disk), so this
 * is a thin view over the reference: id = the `s3://` URI (also what Fine-tune
 * submits), source = "Cloud Storage". Row-level validation/quality aren't known
 * from a bare reference, so those default to "ready, unscanned" like the TL path.
 */
export type S3DatasetRow = {
  ref: string;
  bucket: string;
  key: string;
  name: string;
  format: "jsonl" | "csv" | "folder" | "corpus";
  sizeKb: number | null;
  importedAt: string;
  /** Real counts computed server-side (list route); absent on older payloads. */
  fileCount?: number;
  totalRows?: number;
  rowsCapped?: boolean;
};

function formatLabel(row: S3DatasetRow): string {
  // A whole prefix/bucket import ("folder") holds many files — show that, not a
  // single-file size which wouldn't be meaningful.
  const files = row.fileCount;
  const fileSuffix = typeof files === "number" ? ` · ${files} file${files === 1 ? "" : "s"}` : "";
  if (row.format === "corpus") return `${row.key ? "S3 corpus folder" : "S3 corpus bucket"} (PDFs / raw)${fileSuffix}`;
  if (row.format === "folder") return `${row.key ? "S3 folder" : "S3 bucket"} (all files)${fileSuffix}`;
  const ext = row.format.toUpperCase();
  if (row.sizeKb == null || row.sizeKb <= 0) return ext;
  return row.sizeKb >= 1024 ? `${ext} · ${(row.sizeKb / 1024).toFixed(1)} MB` : `${ext} · ${row.sizeKb} KB`;
}

export function s3ToDataset(row: S3DatasetRow): Dataset {
  const totalRows = typeof row.totalRows === "number" ? row.totalRows : 0;
  const invalidRows = 0;
  const validationStatus = deriveValidationStatus(invalidRows, 0);
  const ts = row.importedAt || new Date().toISOString();
  return {
    id: row.ref,
    name: row.name,
    description: `Imported from ${row.ref} (loaded by reference — not copied to disk).`,
    datasetType: "Training Dataset",
    source: "Cloud Storage",
    currentVersion: "v1",
    totalRows,
    validRows: totalRows,
    invalidRows,
    validationStatus,
    usageCount: 0,
    lastUpdated: ts,
    owner: "—",
    tags: ["s3", row.bucket],
    accessLevel: "Private",
    notes: "",
    format: formatLabel(row),
    createdAt: ts,
    schemaMapping: [],
    validationSummary: buildValidationSummary(totalRows, invalidRows),
    issues: [],
    versions: [
      {
        id: `${row.ref}-v1`,
        version: "v1",
        changes: "Imported from S3 by reference",
        rows: totalRows,
        validationStatus,
        qualityScore: 100,
        createdBy: "System",
        createdAt: ts,
        isActive: true,
      },
    ],
    split: { training: 100, validation: 0, testing: 0, evaluation: 0 },
    usage: [],
    activityLog: [
      {
        id: `${row.ref}-act-1`,
        timestamp: ts,
        actor: "System",
        activity: "Imported",
        description: `Registered ${row.ref} from S3/MinIO (reference only).`,
      },
    ],
    readiness: buildReadiness({ datasetType: "Training Dataset", validationStatus, invalidRows }),
    huggingFaceSource: null,
    rag: null,
  };
}
