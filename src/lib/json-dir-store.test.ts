import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJsonDirStore, type StoredRecord } from "@/lib/json-dir-store";

type Rec = StoredRecord & { n: number };

describe("createJsonDirStore", () => {
  let tmp: string;
  const prev = process.env.RANTAI_DATA_DIR;
  const make = (keep = 1) => createJsonDirStore<Rec>({ dirName: "t", keep, staleMs: 60_000, heavy: [], sortKey: "updatedAt" });

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jds-"));
    process.env.RANTAI_DATA_DIR = tmp;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.RANTAI_DATA_DIR;
    else process.env.RANTAI_DATA_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("does not bring a deleted record back when a still-running writer saves", async () => {
    const s = make();
    const rec: Rec = { id: "a", status: "running", updatedAt: Date.now(), n: 0 };
    await s.create(rec);
    await s.remove("a");
    await s.save({ ...rec, n: 1 });
    expect(await s.read("a")).toBeNull();
  });

  it("never prunes a running record", async () => {
    const s = make(1);
    const now = Date.now();
    await s.create({ id: "old-run", status: "running", updatedAt: now, n: 0 });
    await s.create({ id: "d1", status: "done", updatedAt: now + 1, n: 0 });
    await s.create({ id: "d2", status: "done", updatedAt: now + 2, n: 0 });
    await s.prune();
    expect(await s.read("old-run")).not.toBeNull();
    expect(await s.read("d2")).not.toBeNull();
    expect(await s.read("d1")).toBeNull();
  });
});
