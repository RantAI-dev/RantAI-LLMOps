import { describe, expect, it } from "vitest";

import { imageRelpathProblem, mimeForPath, planBatches, sniffImageMime, visionLimits } from "@/lib/vision-limits";

describe("imageRelpathProblem", () => {
  it("accepts images under images/", () => {
    for (const ok of ["images/a.png", "images/sub/dir/b.JPG", "images/c d.webp", "images/é.jpeg"]) expect(imageRelpathProblem(ok)).toBeNull();
  });
  it("refuses traversal, absolute paths, other folders, odd characters and other types", () => {
    for (const bad of ["", "a.png", "train.jsonl", "images/", "images/a.gif", "images/../a.png", "../images/a.png", "/images/a.png", "images//a.png", "images/./a.png", "images\\a.png", "images/a\u0000.png", "images/a\n.png", "other/a.png", "images/a.svg"]) {
      expect(imageRelpathProblem(bad), JSON.stringify(bad)).not.toBeNull();
    }
    expect(imageRelpathProblem("images/" + "x".repeat(400) + ".png")).toMatch(/longer/);
  });
});

describe("sniffImageMime / mimeForPath", () => {
  it("recognises png, jpeg and webp by content", () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });
  it("refuses everything else (svg, html, gif, empty)", () => {
    expect(sniffImageMime(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageMime(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageMime(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
  it("maps extensions", () => {
    expect(mimeForPath("images/a.JPG")).toBe("image/jpeg");
    expect(mimeForPath("images/a.jpeg")).toBe("image/jpeg");
    expect(mimeForPath("images/a.png")).toBe("image/png");
    expect(mimeForPath("images/a.webp")).toBe("image/webp");
    expect(mimeForPath("images/a.gif")).toBeNull();
  });
});

describe("planBatches", () => {
  const items = (...sizes: number[]) => sizes.map((size, i) => ({ size, i }));
  it("fills each batch up to the limit, in order", () => {
    expect(planBatches(items(5, 5, 5, 5, 5), 10).map((b) => b.map((x) => x.i))).toEqual([[0, 1], [2, 3], [4]]);
  });
  it("gives an item bigger than the limit a batch of its own", () => {
    expect(planBatches(items(3, 50, 3), 10).map((b) => b.map((x) => x.size))).toEqual([[3], [50], [3]]);
  });
  it("handles nothing", () => {
    expect(planBatches([], 10)).toEqual([]);
  });
});

describe("visionLimits", () => {
  it("defaults to 2 GB / 10 MB and reads the environment", () => {
    expect(visionLimits({})).toEqual({ maxDatasetBytes: 2 * 1024 ** 3, maxImageBytes: 10 * 1024 ** 2 });
    expect(visionLimits({ VISION_DATASET_MAX_BYTES: "1000", VISION_IMAGE_MAX_BYTES: "50" })).toEqual({ maxDatasetBytes: 1000, maxImageBytes: 50 });
    expect(visionLimits({ VISION_DATASET_MAX_BYTES: "junk", VISION_IMAGE_MAX_BYTES: "-3" }).maxImageBytes).toBe(10 * 1024 ** 2);
  });
});
