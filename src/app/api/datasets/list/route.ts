import { listTlDatasets } from "@/lib/finetune";
import { listImportedS3Datasets, summarizeS3Dataset } from "@/lib/s3-datasets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real datasets for the registry, from two seams:
 *  - `datasets`: what's on disk in Transformer Lab (`/data/list`).
 *  - `s3`: datasets imported by reference from S3/MinIO (the manifest) — never
 *    copied to disk, so they show here without duplicating the data.
 * Degrades to empty lists (never 500s) when either source is unavailable.
 */
export async function GET() {
  const [datasets, s3] = await Promise.all([
    listTlDatasets().catch((err) => {
      console.error("[api/datasets/list] Transformer Lab unreachable:", err);
      return [];
    }),
    listImportedS3Datasets().catch((err) => {
      console.error("[api/datasets/list] S3 manifest unreachable:", err);
      return [];
    }),
  ]);
  // Attach real file/row counts so the Library card reflects what actually loaded
  // (imported references otherwise report a hardcoded 0). Best-effort per entry.
  const s3WithCounts = await Promise.all(
    s3.map(async (entry) => {
      try {
        const s = await summarizeS3Dataset(entry);
        return { ...entry, fileCount: s.files, totalRows: s.rows, rowsCapped: s.capped };
      } catch (err) {
        console.error(`[api/datasets/list] count failed for ${entry.ref}:`, err);
        return entry;
      }
    })
  );
  return Response.json({ datasets, s3: s3WithCounts });
}
