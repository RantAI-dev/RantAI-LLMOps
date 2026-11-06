import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { extractZip, imageDataUrl, listZip, normalizeZipListing } from "@/modules/datasets/lib/vision-zip";

const e = (name: string, size = 10) => ({ name, size });

describe("normalizeZipListing", () => {
  it("finds train.jsonl, eval.jsonl and the images", () => {
    const l = normalizeZipListing([e("train.jsonl"), e("eval.jsonl"), e("images/"), e("images/a.png"), e("images/sub/b.JPG"), e("README.md")]);
    expect(l.prefix).toBe("");
    expect(l.train?.name).toBe("train.jsonl");
    expect(l.eval?.name).toBe("eval.jsonl");
    expect(l.images.map((i) => i.path)).toEqual(["images/a.png", "images/sub/b.JPG"]);
    expect(l.ignored).toBe(1);
    expect(l.rejected).toEqual([]);
  });

  it("strips the single wrapper folder of a zipped directory, and macOS metadata", () => {
    const l = normalizeZipListing([e("ds/"), e("ds/train.jsonl"), e("ds/images/a.png"), e("__MACOSX/ds/._train.jsonl"), e("ds/.DS_Store")]);
    expect(l.prefix).toBe("ds/");
    expect(l.train?.name).toBe("ds/train.jsonl");
    expect(l.images).toEqual([{ path: "images/a.png", zipName: "ds/images/a.png", size: 10 }]);
    expect(l.ignored).toBe(0);
  });

  it("does not guess when there are several candidates, or no train.jsonl", () => {
    expect(normalizeZipListing([e("a/train.jsonl"), e("b/train.jsonl")]).train).toBeNull();
    expect(normalizeZipListing([e("images/a.png")]).train).toBeNull();
  });

  it("rejects images of other types and names that climb out of images/", () => {
    const l = normalizeZipListing([e("train.jsonl"), e("images/a.gif"), e("images/../x.png"), e("images/ok.webp")]);
    expect(l.images.map((i) => i.path)).toEqual(["images/ok.webp"]);
    expect(l.rejected).toEqual(["images/a.gif", "images/../x.png"]);
  });
});

describe("listZip / extractZip / imageDataUrl", () => {
  const zip = zipSync({
    "train.jsonl": strToU8('{"a":1}\n'),
    "images/a.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    "images/b.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]),
  });

  it("lists names and sizes without extracting", () => {
    expect(listZip(zip).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "images/a.png", size: 7 },
      { name: "images/b.png", size: 8 },
      { name: "train.jsonl", size: 8 },
    ]);
  });

  it("extracts only what is asked for", () => {
    const got = extractZip(zip, ["images/b.png"]);
    expect(Object.keys(got)).toEqual(["images/b.png"]);
    expect([...got["images/b.png"]!]).toEqual([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
  });

  it("refuses something that is not a ZIP", () => {
    expect(() => listZip(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]))).toThrow();
  });

  it("makes a data URL", () => {
    expect(imageDataUrl("images/a.png", new Uint8Array([1, 2, 3]))).toBe("data:image/png;base64,AQID");
    expect(imageDataUrl("images/a.jpg", new Uint8Array([1]))).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe("the committed fixture ZIP (tests/fixtures/vision-dataset.zip)", () => {
  // Same file the server-side test uploads: 25 rows, 10 images. Made by scripts/vlm/make_fixture_zip.py.
  const load = async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", "vision-dataset.zip")));
  };
  const review = async (bytes: Uint8Array) => {
    const { reviewVision } = await import("@/modules/datasets/lib/review");
    const layout = normalizeZipListing(listZip(bytes));
    const train = layout.train ? new TextDecoder().decode(extractZip(bytes, [layout.train.name])[layout.train.name]) : null;
    return reviewVision({ layout, trainText: train, evalText: null, zipBytes: bytes.length });
  };

  it("is accepted: 25 valid rows, 10 images, nothing missing", async () => {
    const r = await review(await load());
    expect(r.blocked).toBeNull();
    expect(r.train).toMatchObject({ total: 25, valid: 25 });
    expect(r).toMatchObject({ imageCount: 10, missing: [], unused: [] });
    expect(r.sample).toHaveLength(8);
  });

  it("is refused in the browser once one image is taken out", async () => {
    const { unzipSync, zipSync } = await import("fflate");
    const files = unzipSync(await load());
    delete files["images/3.png"];
    const r = await review(zipSync(files));
    expect(r.missing).toEqual(["images/3.png"]);
    expect(r.blocked).toContain("images/3.png");
  });
});
