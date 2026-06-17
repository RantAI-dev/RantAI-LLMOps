import { describe, expect, it } from "vitest";

import { computeSummaryStats, filterModels, generateId } from "@/modules/model-registry/lib/utils";
import type { ModelFilters, RegistryModel } from "@/modules/model-registry/types";

function model(overrides: Partial<RegistryModel> = {}): RegistryModel {
  return {
    status: "Available",
    deploymentReadiness: "Ready",
    compatibilityStatus: "vLLM Compatible",
    provider: "Hugging Face",
    task: "Chat",
    accessType: "Public",
    modelName: "Test Model",
    repoId: "org/test",
    author: "org",
    tags: [],
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  } as RegistryModel;
}

const baseFilters: ModelFilters = {
  search: "",
  provider: "all",
  task: "all",
  status: "all",
  access: "all",
  compatibility: "all",
};

describe("generateId", () => {
  it("produces unique, prefixed, incrementing ids", () => {
    const a = generateId("model");
    const b = generateId("model");
    expect(a).toMatch(/^model-\d+$/);
    expect(a).not.toBe(b);
  });
});

describe("computeSummaryStats", () => {
  it("counts active, ready-to-deploy, need-review and production models", () => {
    const stats = computeSummaryStats([
      model({ status: "Available", deploymentReadiness: "Ready" }),
      model({ status: "Production" }),
      model({ status: "Need Review" }),
      model({ status: "Archived" }),
    ]);
    expect(stats.total).toBe(3); // archived excluded
    expect(stats.readyToDeploy).toBe(1);
    expect(stats.inProduction).toBe(1);
    expect(stats.needReview).toBe(1);
  });
});

describe("filterModels", () => {
  const models = [
    model({ modelName: "Qwen", provider: "Hugging Face", status: "Available" }),
    model({ modelName: "Local LoRA", provider: "Local", status: "Production" }),
    model({ modelName: "Old", status: "Archived" }),
  ];

  it("hides archived models unless explicitly filtered", () => {
    expect(filterModels(models, baseFilters)).toHaveLength(2);
    expect(filterModels(models, { ...baseFilters, status: "Archived" })).toHaveLength(1);
  });

  it("filters by provider and free-text search", () => {
    expect(filterModels(models, { ...baseFilters, provider: "Local" })).toHaveLength(1);
    const found = filterModels(models, { ...baseFilters, search: "qwen" });
    expect(found).toHaveLength(1);
    expect(found[0]?.modelName).toBe("Qwen");
  });
});
