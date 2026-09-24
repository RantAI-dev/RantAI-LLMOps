import { describe, expect, it } from "vitest";

import { FEATURE_STATUS, getFeatureStatus, isNavMock } from "@/lib/feature-status";

describe("feature-status", () => {
  it("has no mock features left — the placeholder cards were removed", () => {
    // Every page reads a real endpoint; the zero-filled analytics cards that
    // used to sit inside them were deleted on 24 Sep 2026.
    expect(Object.values(FEATURE_STATUS)).not.toContain("mock");
    expect(getFeatureStatus("task.list")).toBe("live");
    expect(getFeatureStatus("dataset.upload")).toBe("live");
    expect(getFeatureStatus("model.catalog")).toBe("live");
    expect(getFeatureStatus("serve.engines")).toBe("live");
  });

  it("does not flag real nav labels (no mock-gated menus right now)", () => {
    expect(isNavMock("Compute")).toBe(false); // now reads the real TL provider list
    expect(isNavMock("Dashboard")).toBe(false);
    expect(isNavMock("Interact")).toBe(false); // real chat playground (chat.playground = live)
    expect(isNavMock("Not a real menu")).toBe(false);
  });
});
