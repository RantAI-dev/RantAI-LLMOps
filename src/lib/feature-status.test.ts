import { describe, expect, it } from "vitest";

import { getFeatureStatus, isMock, isNavMock } from "@/lib/feature-status";

describe("feature-status", () => {
  it("reports the RAG suite as mock", () => {
    expect(getFeatureStatus("rag.documents")).toBe("mock");
    expect(isMock("rag.interact")).toBe(true);
    expect(isMock("rag.evals")).toBe(true);
  });

  it("does not flag real nav labels (no mock-gated menus right now)", () => {
    expect(isNavMock("Compute")).toBe(false); // now reads the real TL provider list
    expect(isNavMock("Dashboard")).toBe(false);
    expect(isNavMock("Interact")).toBe(false); // real chat playground (chat.playground = live)
    expect(isNavMock("Not a real menu")).toBe(false);
  });
});
