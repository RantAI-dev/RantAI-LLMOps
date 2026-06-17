import { describe, expect, it } from "vitest";

import { getFeatureStatus, isMock, isNavMock } from "@/lib/feature-status";

describe("feature-status", () => {
  it("reports the RAG suite as mock", () => {
    expect(getFeatureStatus("rag.documents")).toBe("mock");
    expect(isMock("rag.interact")).toBe(true);
    expect(isMock("rag.evals")).toBe(true);
  });

  it("flags mock nav labels and ignores live/unknown ones", () => {
    expect(isNavMock("Interact")).toBe(true);
    expect(isNavMock("Documents")).toBe(true);
    expect(isNavMock("Dashboard")).toBe(false);
    expect(isNavMock("Not a real menu")).toBe(false);
  });
});
