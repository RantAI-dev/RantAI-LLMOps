import { describe, expect, it } from "vitest";

import { compact, formatSize } from "@/modules/hub/lib/format";

describe("compact", () => {
  it("keeps small numbers as-is", () => {
    expect(compact(0)).toBe("0");
    expect(compact(999)).toBe("999");
  });
  it("uses k for thousands and M for millions", () => {
    expect(compact(1500)).toBe("1.5k");
    expect(compact(2_500_000)).toBe("2.5M");
  });
});

describe("formatSize", () => {
  it("formats MB and GB", () => {
    expect(formatSize(397)).toBe("397 MB");
    expect(formatSize(2048)).toBe("2.0 GB");
    expect(formatSize(770)).toBe("770 MB");
  });
  it("returns a dash for null/zero", () => {
    expect(formatSize(null)).toBe("—");
    expect(formatSize(0)).toBe("—");
  });
});
