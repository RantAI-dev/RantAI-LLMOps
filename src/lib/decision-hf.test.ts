// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings-store", () => ({ getHfToken: async () => "" }));
vi.mock("@/lib/finetune", () => ({
  DatasetInputError: class DatasetInputError extends Error {},
  fetchLocalDatasets: vi.fn(async () => []),
  slugifyDatasetName: (n: string) => n.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
  uploadDecisionDataset: vi.fn(async (id: string) => ({ id })),
}));

import { fetchHfJsonl, hfDatasetId, isHfDatasetId, resolveHfSource } from "@/lib/decision-hf";

const SPLITS = {
  splits: [
    { config: "all", split: "train" },
    { config: "all", split: "test" },
    { config: "customer_service", split: "train" },
  ],
};

describe("decision-hf", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it("tells a hub id from local names, paths and URLs", () => {
    expect(isHfDatasetId("LocalLLaMA/typed-decisions")).toBe(true);
    expect(isHfDatasetId("typed-decisions-all")).toBe(false);
    expect(isHfDatasetId("s3://b/p/")).toBe(false);
    expect(isHfDatasetId("./a/b")).toBe(false);
  });

  it("gives different sources different ids even when their names slug alike", () => {
    const a = hfDatasetId("owner/a", "b-c");
    const b = hfDatasetId("owner/a-b", "c");
    expect(a).not.toBe(b);
    expect(a.startsWith("hf-owner-a-b-c-")).toBe(true);
    expect(hfDatasetId("owner/a", "b-c")).toBe(a); // stable, so a re-import reuses it
  });

  it("checks subset and splits against what the dataset offers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(SPLITS)));
    await expect(resolveHfSource("o/d")).resolves.toEqual({ config: "all", split: "train", evalSplit: "test" });
    await expect(resolveHfSource("o/d", { config: "customer_service" })).resolves.toEqual({
      config: "customer_service",
      split: "train",
      evalSplit: null,
    });
    await expect(resolveHfSource("o/d", { evalSplit: "" })).resolves.toMatchObject({ evalSplit: null });
    await expect(resolveHfSource("o/d", { config: "nope" })).rejects.toThrow(/no subset "nope".*all, customer_service/);
    await expect(resolveHfSource("o/d", { split: "nosplit" })).rejects.toThrow(/no split "nosplit"/);
  });

  it("retries a rate limit and then succeeds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(Response.json(SPLITS));
    vi.stubGlobal("fetch", f);
    const p = resolveHfSource("o/d");
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toMatchObject({ config: "all" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("pages through rows and refuses a cell the rows API truncated", async () => {
    const page = (n: number, truncated = false) =>
      Response.json({
        num_rows_total: 150,
        rows: Array.from({ length: n }, (_, i) => ({ row_idx: i, row: { state: "s", i }, truncated_cells: truncated && i === 3 ? ["state"] : [] })),
      });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page(100)).mockResolvedValueOnce(page(50)));
    const text = await fetchHfJsonl({ dataset: "o/d", config: "all", split: "train", maxRows: 1000 });
    expect(text.split("\n")).toHaveLength(150);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page(100, true)));
    await expect(fetchHfJsonl({ dataset: "o/d", config: "all", split: "train", maxRows: 1000 })).rejects.toThrow(
      /truncated the "state" column/
    );
  });

  it("maps a missing or private dataset to a user error, not a server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(resolveHfSource("o/missing")).rejects.toMatchObject({ name: "Error", message: expect.stringContaining("does not serve") });
  });
});
