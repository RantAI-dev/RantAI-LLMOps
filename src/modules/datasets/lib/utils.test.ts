import { describe, expect, it } from "vitest";

import {
  buildValidationSummary,
  computeQualityScore,
  deriveValidationStatus,
  splitRowCounts,
  splitTotal,
  updateDataset,
} from "@/modules/datasets/lib/utils";
import type { Dataset, DatasetSplit } from "@/modules/datasets/types";

describe("computeQualityScore", () => {
  it("returns the rounded percentage of valid rows", () => {
    expect(computeQualityScore(90, 100)).toBe(90);
    expect(computeQualityScore(1, 3)).toBe(33);
  });

  it("guards against divide-by-zero (no NaN) when there are no rows", () => {
    expect(computeQualityScore(0, 0)).toBe(0);
    expect(Number.isNaN(computeQualityScore(5, 0))).toBe(false);
    expect(computeQualityScore(5, 0)).toBe(0);
  });
});

describe("buildValidationSummary", () => {
  it("derives validRows and a safe quality score", () => {
    const s = buildValidationSummary(100, 10);
    expect(s.totalRows).toBe(100);
    expect(s.validRows).toBe(90);
    expect(s.invalidRows).toBe(10);
    expect(s.dataQualityScore).toBe(90);
  });

  it("never produces negative validRows or NaN at zero rows", () => {
    const s = buildValidationSummary(0, 0);
    expect(s.validRows).toBe(0);
    expect(s.dataQualityScore).toBe(0);
  });

  it("honours overrides", () => {
    const s = buildValidationSummary(100, 10, { duplicateRows: 7 });
    expect(s.duplicateRows).toBe(7);
  });
});

describe("deriveValidationStatus", () => {
  it("prioritises archived then error", () => {
    expect(deriveValidationStatus(0, 0, true, false)).toBe("Archived");
    expect(deriveValidationStatus(0, 0, false, true)).toBe("Error");
  });

  it("maps usage and invalid rows to status", () => {
    expect(deriveValidationStatus(0, 5)).toBe("In Use");
    expect(deriveValidationStatus(3, 0)).toBe("Needs Review");
    expect(deriveValidationStatus(0, 0)).toBe("Ready");
  });
});

describe("split helpers", () => {
  it("splitTotal sums the four parts", () => {
    expect(splitTotal({ training: 80, validation: 10, testing: 10, evaluation: 0 })).toBe(100);
  });

  it("splitRowCounts apportions rows by percentage", () => {
    const split: DatasetSplit = { training: 80, validation: 10, testing: 10, evaluation: 0 };
    expect(splitRowCounts(1000, split)).toEqual({
      training: 800,
      validation: 100,
      testing: 100,
      evaluation: 0,
    });
  });
});

describe("updateDataset", () => {
  const datasets = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ] as unknown as Dataset[];

  it("applies the updater only to the matching id (copy-on-write)", () => {
    const next = updateDataset(datasets, "b", (d) => ({ ...d, name: "B2" }));
    expect(next[1]?.name).toBe("B2");
    expect(next[0]).toBe(datasets[0]); // untouched item keeps identity
    expect(datasets[1]?.name).toBe("B"); // original not mutated
  });

  it("is a no-op when the id is not found", () => {
    const next = updateDataset(datasets, "zzz", (d) => ({ ...d, name: "X" }));
    expect(next).toEqual(datasets);
  });
});
