// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createVlmEvalSetFromZip,
  deleteVlmEvalSet,
  getVlmEvalSet,
  listVlmEvalSets,
  readVlmEvalImage,
  readVlmEvalRows,
  vlmEvalLimits,
  VlmEvalSetError,
} from "@/lib/vlm-eval-set-store";
import { evalRow, JPG, makeZip, PNG } from "@/lib/vlm-eval-test-helpers";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rantai-vlm-sets-"));
  process.env.RANTAI_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RANTAI_DATA_DIR;
});

let n = 0;
const uniq = () => `set ${++n}`;
const create = (zip: Uint8Array, over: Partial<Parameters<typeof createVlmEvalSetFromZip>[0]> = {}) =>
  createVlmEvalSetFromZip({ name: uniq(), scoring: "exact", zip, ...over });

const rejects = async (p: Promise<unknown>, status: number, message: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(VlmEvalSetError);
  expect((err as VlmEvalSetError).status).toBe(status);
  expect((err as VlmEvalSetError).message).toMatch(message);
};

describe("createVlmEvalSetFromZip", () => {
  it("stores meta, rows and the images the rows use", async () => {
    const set = await createVlmEvalSetFromZip({ name: "LaTeX Test!", scoring: "latex", zip: makeZip({ n: 6 }) });
    expect(set).toMatchObject({ id: "latex-test", name: "LaTeX Test!", scoring: "latex", rows: 6, images: 6, source: "upload" });
    expect(set.createdAt).toBeGreaterThan(0);
    expect(await getVlmEvalSet("latex-test")).toEqual(set);
    const rows = (await readVlmEvalRows("latex-test"))!;
    expect(rows).toHaveLength(6);
    expect(rows[2]).toEqual({ id: 2, images: ["images/img2.png"], prompt: "What is in image 2?", gold: "k2" });
    const img = (await readVlmEvalImage("latex-test", "images/img2.png"))!;
    expect(img.mime).toBe("image/png");
    expect([...img.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect((await listVlmEvalSets()).map((s) => s.id)).toContain("latex-test");
  });

  it("strips a wrapper folder, keeps only used images, and carries system and category", async () => {
    const zip = makeZip({
      n: 5,
      prefix: "mydata/",
      rows: [JSON.stringify({ category: " bar ", messages: [{ role: "system", content: "Be terse." }, { role: "user", content: [{ type: "image", image: "./images/extra.jpg" }, { type: "text", text: "Q?" }] }, { role: "assistant", content: "A" }] })],
      files: { "mydata/images/extra.jpg": JPG, "mydata/images/unused.png": PNG, "__MACOSX/x": PNG },
    });
    const set = await create(zip, { scoring: "choice" });
    expect(set).toMatchObject({ rows: 6, images: 6 });
    const rows = (await readVlmEvalRows(set.id))!;
    expect(rows[5]).toEqual({ id: 5, images: ["images/extra.jpg"], prompt: "Q?", gold: "A", system: "Be terse.", category: "bar" });
    expect(await readVlmEvalImage(set.id, "images/unused.png")).toBeNull();
    expect((await readVlmEvalImage(set.id, "images/extra.jpg"))!.mime).toBe("image/jpeg");
  });

  it("scores the last assistant message and ignores eval.jsonl", async () => {
    const zip = makeZip({ n: 5, files: { "eval.jsonl": new TextEncoder().encode(evalRow("images/img0.png", "other", "other") + "\n") } });
    const set = await create(zip);
    expect(set.rows).toBe(5);
  });

  it("refuses a bad name, a bad scoring mode and a taken name", async () => {
    const zip = makeZip();
    await rejects(createVlmEvalSetFromZip({ name: "  ", scoring: "exact", zip }), 400, /name is required/);
    await rejects(createVlmEvalSetFromZip({ name: "!!!", scoring: "exact", zip }), 400, /name is required/);
    await rejects(createVlmEvalSetFromZip({ name: "x".repeat(200), scoring: "exact", zip }), 400, /at most 120/);
    await rejects(createVlmEvalSetFromZip({ name: "ok name", scoring: "fuzzy", zip }), 400, /Scoring must be one of/);
    await createVlmEvalSetFromZip({ name: "taken", scoring: "exact", zip });
    await rejects(createVlmEvalSetFromZip({ name: "Taken", scoring: "exact", zip }), 409, /already exists/);
  });

  it("refuses something that is not a ZIP, and a ZIP without train.jsonl", async () => {
    await rejects(create(new TextEncoder().encode("hello, not a zip")), 400, /not a valid ZIP/);
    await rejects(create(makeZip({ noTrain: true })), 400, /no train\.jsonl/);
  });

  it("refuses rows whose image is not in the ZIP (a broken upload), naming it", async () => {
    const zip = makeZip({ n: 5, rows: [evalRow("images/gone.png", "q", "a")] });
    await rejects(create(zip), 400, /images\/gone\.png/);
  });

  it("refuses a set with too few valid rows", async () => {
    await rejects(create(makeZip({ n: 3 })), 400, /at least 5/);
  });

  it("refuses https:// and s3:// images: the images must be inside the ZIP", async () => {
    const zip = makeZip({ n: 5, rows: [evalRow("https://example.com/a.png", "q", "a")] });
    await rejects(create(zip), 400, /inside the ZIP/);
  });

  it("refuses a row without an image", async () => {
    const noImage = JSON.stringify({ messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }] });
    await rejects(create(makeZip({ n: 30, rows: [noImage] })), 400, /has no image/);
  });

  it("refuses more rows than the limit, with 413", async () => {
    const limits = { ...vlmEvalLimits({}), maxRows: 5 };
    await rejects(create(makeZip({ n: 6 }), { limits }), 413, /6 rows; at most 5/);
  });

  it("refuses a ZIP, an image and a total over their limits before inflating anything", async () => {
    const limits = vlmEvalLimits({});
    await rejects(create(makeZip({ n: 5 }), { limits: { ...limits, maxBytes: 50 } }), 413, /ZIP is larger/);
    // 3 MB of zeros compress to a few KB: the size is read from the header, so a "bomb" is stopped by its claim.
    const big = zipSync({
      "train.jsonl": new TextEncoder().encode(Array.from({ length: 5 }, (_, i) => evalRow(`images/b${i}.png`, "q", "a")).join("\n")),
      ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`images/b${i}.png`, new Uint8Array([...PNG, ...new Uint8Array(3 * 1024 * 1024)])])),
    });
    expect(big.byteLength).toBeLessThan(200 * 1024);
    await rejects(create(big, { limits: { ...limits, maxImageBytes: 1024 * 1024 } }), 413, /images\/b0\.png is larger/);
    await rejects(create(big, { limits: { ...limits, maxBytes: 10 * 1024 * 1024 } }), 413, /add up to more than/);
  });

  it("refuses an image whose bytes are not what its name says", async () => {
    const wrongKind = makeZip({ n: 4, rows: [evalRow("images/fake.png", "q", "a")], files: { "images/fake.png": new TextEncoder().encode("<html>not an image</html>") } });
    await rejects(create(wrongKind), 400, /images\/fake\.png is not a png, jpeg or webp/);
    const jpegAsPng = makeZip({ n: 4, rows: [evalRow("images/x.png", "q", "a")], files: { "images/x.png": JPG } });
    await rejects(create(jpegAsPng), 400, /is a jpeg image, but its name says otherwise/);
  });

  it("does not let a hostile entry name reach outside the set", async () => {
    const evil = zipSync({
      "train.jsonl": new TextEncoder().encode(Array.from({ length: 5 }, (_, i) => evalRow(`images/${i === 0 ? "../../evil" : "ok" + i}.png`, "q", "a")).join("\n")),
      "images/../../evil.png": PNG,
      "../evil.png": PNG,
      "/abs.png": PNG,
      ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`images/ok${i + 1}.png`, PNG])),
    });
    await rejects(create(evil), 400, /\.\./);
    expect(readdirSync(dir).filter((f) => f.includes("evil"))).toEqual([]);
  });

  it("leaves no scratch folder behind after a refusal, and none in the list", async () => {
    await create(makeZip({ n: 3 })).catch(() => {});
    const entries = readdirSync(path.join(dir, "vlm-eval-sets"));
    expect(entries.filter((e) => e.startsWith(".tmp-"))).toEqual([]);
    expect((await listVlmEvalSets()).every((s) => !s.id.startsWith("."))).toBe(true);
  });

  it("tolerates a row that is not JSON within the 2% allowance, and drops it", async () => {
    const set = await create(makeZip({ n: 60, rows: ["not json"] }));
    expect(set.rows).toBe(60);
  });
});

describe("reading a set", () => {
  it("serves only images under images/, from inside the set", async () => {
    const set = await create(makeZip({ n: 5 }));
    expect(await readVlmEvalImage(set.id, "images/img0.png")).not.toBeNull();
    for (const bad of ["meta.json", "rows.jsonl", "images/../meta.json", "../x/images/img0.png", "/etc/passwd", "images//img0.png", "images/img0.txt", "images/nope.png", "images\\img0.png", ""]) {
      expect(await readVlmEvalImage(set.id, bad)).toBeNull();
    }
  });

  it("answers null for a set that does not exist and throws for an unsafe id", async () => {
    expect(await getVlmEvalSet("no-such-set")).toBeNull();
    expect(await readVlmEvalRows("no-such-set")).toBeNull();
    expect(await readVlmEvalImage("no-such-set", "images/a.png")).toBeNull();
    for (const bad of ["../x", "a/b", "A", ".tmp-x", ""]) {
      await expect(getVlmEvalSet(bad)).rejects.toThrow(VlmEvalSetError);
      await expect(readVlmEvalRows(bad)).rejects.toThrow(/Invalid/);
      await expect(readVlmEvalImage(bad, "images/a.png")).rejects.toThrow(/Invalid/);
      await expect(deleteVlmEvalSet(bad)).rejects.toThrow(/Invalid/);
    }
  });

  it("deletes a set with its images", async () => {
    const set = await create(makeZip({ n: 5 }));
    await deleteVlmEvalSet(set.id);
    expect(await getVlmEvalSet(set.id)).toBeNull();
    expect(await readVlmEvalImage(set.id, "images/img0.png")).toBeNull();
    expect((await listVlmEvalSets()).map((s) => s.id)).not.toContain(set.id);
    await deleteVlmEvalSet(set.id); // already gone: not an error
  });
});

describe("vlmEvalLimits", () => {
  it("defaults to 500 rows, 200 MB and 10 MB per image, and reads the environment", () => {
    expect(vlmEvalLimits({})).toEqual({ maxRows: 500, maxBytes: 200 * 1024 * 1024, maxImageBytes: 10 * 1024 * 1024 });
    expect(vlmEvalLimits({ VLM_EVAL_MAX_ROWS: "50", VLM_EVAL_MAX_BYTES: "1000", VLM_EVAL_MAX_IMAGE_BYTES: "10" })).toEqual({ maxRows: 50, maxBytes: 1000, maxImageBytes: 10 });
    expect(vlmEvalLimits({ VLM_EVAL_MAX_ROWS: "nope", VLM_EVAL_MAX_BYTES: "-5" })).toMatchObject({ maxRows: 500, maxBytes: 200 * 1024 * 1024 });
  });
});
