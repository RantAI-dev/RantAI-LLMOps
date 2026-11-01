/**
 * One-JSON-file-per-record store under the app's data directory (RANTAI_DATA_DIR, the `ui_data`
 * volume in Docker). Used for eval runs: a run writes its progress repeatedly while it works, so a
 * shared file would let concurrent runs clobber each other; one file per run does not.
 *
 * Records have an `id`, a `status` and an `updatedAt`. A "running" record whose progress stopped long
 * ago lost its process (a container restart, say); reading it reports "interrupted" instead of a
 * run that will never finish. The older grounding/classification stores do the same by hand.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type StoredRecord = { id: string; status: string; updatedAt: number; error?: string };

export function dataDir(): string {
  return process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
}

/** Write via a temp file + rename so a reader never sees a half-written file. */
export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

export function createJsonDirStore<T extends StoredRecord>(opts: {
  dirName: string;
  /** Records kept by `prune` (newest first); the per-row detail makes each file sizeable. */
  keep: number;
  staleMs: number;
  /** Fields left out of `list()` (the heavy ones). */
  heavy: ReadonlyArray<keyof T>;
  sortKey: keyof T & string;
}) {
  const dir = () => path.join(dataDir(), opts.dirName);
  const file = (id: string) => {
    // ids are generated here (UUIDs), but this value reaches the filesystem: refuse anything that could escape.
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Invalid id: ${JSON.stringify(id)}`);
    return path.join(dir(), `${id}.json`);
  };
  const derive = (rec: T): T =>
    rec.status === "running" && Date.now() - rec.updatedAt > opts.staleMs
      ? { ...rec, status: "interrupted", error: "The process stopped before finishing (server restart?)" }
      : rec;

  return {
    async create(rec: T): Promise<T> {
      await atomicWrite(file(rec.id), JSON.stringify(rec));
      return rec;
    },
    /** Throws on an invalid id (callers answer 400); null when there is no such record. */
    async read(id: string): Promise<T | null> {
      const f = file(id);
      try {
        return derive(JSON.parse(await fs.readFile(f, "utf8")) as T);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[${opts.dirName}] read failed:`, err);
        return null;
      }
    },
    /** Updates an existing record only: a record deleted meanwhile (a run still going) must not reappear. */
    async save(rec: T): Promise<void> {
      try {
        await fs.access(file(rec.id));
      } catch {
        return;
      }
      await atomicWrite(file(rec.id), JSON.stringify({ ...rec, updatedAt: Date.now() }));
    },
    /** Records without their heavy fields, newest first. */
    async list(): Promise<Array<StoredRecord & Partial<T>>> {
      let names: string[];
      try {
        names = await fs.readdir(dir());
      } catch {
        return [];
      }
      const out: Array<StoredRecord & Partial<T>> = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const rec = derive(JSON.parse(await fs.readFile(path.join(dir(), name), "utf8")) as T);
          for (const k of opts.heavy) delete (rec as Record<string, unknown>)[k as string];
          out.push(rec as StoredRecord & Partial<T>);
        } catch {
          /* skip a corrupt or half-written file */
        }
      }
      return out.sort((a, b) => Number((b as Record<string, unknown>)[opts.sortKey]) - Number((a as Record<string, unknown>)[opts.sortKey]));
    },
    async remove(id: string): Promise<void> {
      await fs.rm(file(id), { force: true });
    },
    async prune(): Promise<void> {
      try {
        const all = await this.list();
        // A run still going is never pruned (list() already reports a dead one as interrupted).
        await Promise.all(all.filter((r) => r.status !== "running").slice(opts.keep).map((r) => this.remove(r.id)));
      } catch (err) {
        console.error(`[${opts.dirName}] prune failed:`, err);
      }
    },
  };
}
