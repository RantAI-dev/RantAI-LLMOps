// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake Transformer Lab (datasets, chunked uploads, files) and a fake S3: the point is WHAT gets stored and
// where, and what is refused before anything is kept.
const tl = vi.hoisted(() => ({
  datasets: new Map<string, Map<string, Uint8Array | string>>(),
  staging: new Map<string, { filename: string; bytes: Uint8Array }>(),
  calls: [] as string[],
}));
const s3 = vi.hoisted(() => ({ objects: new Map<string, Uint8Array | string>(), configured: true }));

vi.mock("@/lib/tl-fetch", () => ({
  tlFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://tl");
    const q = u.searchParams;
    const id = q.get("dataset_id") ?? "";
    tl.calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
    if (u.pathname === "/data/list") return Response.json([...tl.datasets.keys()].map((d) => ({ dataset_id: d })));
    if (u.pathname === "/data/new") {
      tl.datasets.set(id, new Map());
      return Response.json({ status: "success", dataset_id: id });
    }
    if (u.pathname === "/data/delete") {
      tl.datasets.delete(id);
      return Response.json({ status: "success" });
    }
    if (u.pathname === "/upload/init") {
      const b = JSON.parse(String(init!.body)) as { filename: string };
      const uid = String(tl.staging.size + 1).padStart(32, "0");
      tl.staging.set(uid, { filename: b.filename, bytes: new Uint8Array() });
      return Response.json({ upload_id: uid });
    }
    const chunk = /^\/upload\/(\w+)\/chunk$/.exec(u.pathname);
    if (chunk) {
      tl.staging.get(chunk[1]!)!.bytes = init!.body as Uint8Array;
      return Response.json({ received: [0] });
    }
    if (/^\/upload\/\w+\/complete$/.test(u.pathname)) return Response.json({ temp_path: "x" });
    if (/^\/upload\/\w+$/.test(u.pathname) && init?.method === "DELETE") return Response.json({ status: "deleted" });
    if (u.pathname === "/data/fileupload") {
      const ds = tl.datasets.get(id);
      if (!ds) return new Response("no dataset", { status: 404 });
      const uid = q.get("upload_id");
      if (uid) {
        ds.set(q.get("relpath")!, tl.staging.get(uid)!.bytes);
        tl.staging.delete(uid);
      } else {
        for (const [, v] of (init!.body as FormData).entries()) ds.set((v as File).name, await (v as File).text());
      }
      return Response.json({ status: "success" });
    }
    if (u.pathname === "/data/files") {
      const ds = tl.datasets.get(id);
      if (!ds) return new Response("nope", { status: 404 });
      return Response.json([...ds].map(([relpath, v]) => ({ relpath, size: typeof v === "string" ? v.length : v.byteLength })));
    }
    if (u.pathname === "/data/file") {
      const v = tl.datasets.get(id)?.get(q.get("relpath")!);
      return v === undefined ? new Response("nf", { status: 404 }) : new Response(v as BodyInit);
    }
    return new Response("not found", { status: 404 });
  }),
  unwrapList: (x: unknown) => x,
}));
vi.mock("@/lib/s3", () => ({
  putObject: vi.fn(async (bucket: string, key: string, body: string | Uint8Array) => {
    s3.objects.set(`${bucket}/${key}`, body);
    return `s3://${bucket}/${key}`;
  }),
  listObjects: vi.fn(async (bucket: string, prefix: string) =>
    [...s3.objects].filter(([k]) => k.startsWith(`${bucket}/${prefix}`)).map(([k, v]) => ({ key: k.slice(bucket.length + 1), size: typeof v === "string" ? v.length : v.byteLength }))
  ),
  deleteObject: vi.fn(async (bucket: string, key: string) => {
    s3.objects.delete(`${bucket}/${key}`);
  }),
  s3Configured: () => s3.configured,
  assertAllowedBucket: (b: string) => {
    if (b !== "bkt") throw new Error(`Bucket "${b}" is not allowed.`);
  },
}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("@/lib/tasks-server", () => ({ allExperimentIds: vi.fn(), createTlExperiment: vi.fn(), resolveJobExperiment: vi.fn() }));
vi.mock("@/lib/models-catalog", () => ({ fetchAdaptors: vi.fn() }));

import {
  VisionUploadError,
  abortVisionDataset,
  completeVisionDataset,
  initVisionDataset,
  previewVisionDataset,
  readVisionImage,
  uploadVisionImages,
} from "@/lib/vision-dataset";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const row = (img: string, n = 0) =>
  JSON.stringify({
    messages: [
      { role: "user", content: [{ type: "image", image: img }, { type: "text", text: `Q${n}` }] },
      { role: "assistant", content: `A${n}` },
    ],
  });
const rows = (n: number, img = "images/a.png") => Array.from({ length: n }, (_, i) => row(img, i)).join("\n");
const ws = { kind: "workspace" } as const;
const bucket = { kind: "s3", bucket: "bkt", prefix: "datasets" } as const;
const fail = async (p: Promise<unknown>): Promise<VisionUploadError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(VisionUploadError);
    return e as VisionUploadError;
  }
  throw new Error("expected a VisionUploadError");
};

beforeEach(() => {
  tl.datasets.clear();
  tl.staging.clear();
  tl.calls = [];
  s3.objects.clear();
  s3.configured = true;
  delete process.env.VISION_IMAGE_MAX_BYTES;
  delete process.env.VISION_DATASET_MAX_BYTES;
});

describe("workspace upload", () => {
  it("stores images under images/, then train.jsonl and eval.jsonl, and returns a vision result", async () => {
    const { id, ref } = await initVisionDataset({ name: "Latex OCR", destination: ws });
    expect(id).toBe("latex-ocr");
    expect(ref).toBe("latex-ocr");
    await uploadVisionImages({ id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }, { relpath: "images/b.jpg", bytes: JPG }] });
    const r = await completeVisionDataset({ id, name: "Latex OCR", destination: ws, train: rows(25), eval: rows(6, "images/b.jpg") });
    expect(r).toMatchObject({ id, ref: "latex-ocr", kind: "vision", images: { stored: 2, referenced: 2, unused: 0 } });
    expect(r.report).toMatchObject({ total: 25, valid: 25 });
    expect(r.eval).toMatchObject({ total: 6, valid: 6 });
    const files = tl.datasets.get("latex-ocr")!;
    expect([...files.keys()].sort()).toEqual(["eval.jsonl", "images/a.png", "images/b.jpg", "train.jsonl"]);
    expect(files.get("images/a.png")).toEqual(PNG);
    expect((files.get("train.jsonl") as string).trim().split("\n")).toHaveLength(25);
    // Each image used the chunked API (the only one that honours relpath).
    expect(tl.calls.filter((c) => c === "POST /data/fileupload").length).toBe(4);
    expect(tl.calls).toContain("PUT /upload/00000000000000000000000000000001/chunk");
  });

  it("counts unused images and drops invalid rows within the 2% allowance", async () => {
    const { id } = await initVisionDataset({ name: "ds", destination: ws });
    await uploadVisionImages({ id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }, { relpath: "images/spare.png", bytes: PNG }] });
    const r = await completeVisionDataset({ id, destination: ws, train: rows(60) + "\nnot json" });
    expect(r.images).toEqual({ stored: 2, referenced: 1, unused: 1 });
    expect(r.report).toMatchObject({ total: 61, valid: 60, invalid: 1 });
    expect((tl.datasets.get("ds")!.get("train.jsonl") as string).trim().split("\n")).toHaveLength(60);
  });

  it("refuses a train.jsonl that points at an image that was not stored, and deletes the dataset", async () => {
    const { id } = await initVisionDataset({ name: "broken", destination: ws });
    await uploadVisionImages({ id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }] });
    const err = await fail(completeVisionDataset({ id, destination: ws, train: rows(25, "images/gone.png") }));
    expect(err.status).toBe(400);
    expect(err.message).toContain("not in the dataset: images/gone.png");
    expect(tl.datasets.has("broken")).toBe(false);
    // The upload is over: a second complete finds nothing open.
    expect((await fail(completeVisionDataset({ id, destination: ws, train: rows(25) }))).status).toBe(404);
  });

  it("refuses even ONE missing image in a big dataset (a broken ZIP is not an odd row)", async () => {
    const { id } = await initVisionDataset({ name: "one-gone", destination: ws });
    await uploadVisionImages({ id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }] });
    const train = rows(200) + "\n" + row("images/lost.png", 201);
    const err = await fail(completeVisionDataset({ id, destination: ws, train }));
    expect(err.message).toMatch(/1 image that is used by the train.jsonl is not in the dataset: images\/lost.png/);
    expect(tl.datasets.has("one-gone")).toBe(false);
  });

  it("refuses too few valid rows and a bad eval file", async () => {
    const a = await initVisionDataset({ name: "few", destination: ws });
    await uploadVisionImages({ id: a.id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }] });
    expect((await fail(completeVisionDataset({ id: a.id, destination: ws, train: rows(5) }))).message).toContain("at least 20");
    const b = await initVisionDataset({ name: "badeval", destination: ws });
    await uploadVisionImages({ id: b.id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }] });
    const err = await fail(completeVisionDataset({ id: b.id, destination: ws, train: rows(25), eval: rows(2) }));
    expect(err.message).toContain("eval.jsonl");
    expect(tl.datasets.has("badeval")).toBe(false);
  });

  it("refuses a name that exists or is being uploaded", async () => {
    tl.datasets.set("taken", new Map());
    expect((await fail(initVisionDataset({ name: "taken", destination: ws }))).status).toBe(409);
    await initVisionDataset({ name: "busy", destination: ws });
    expect((await fail(initVisionDataset({ name: "busy", destination: ws }))).status).toBe(409);
    expect((await fail(initVisionDataset({ name: "!!!", destination: ws }))).status).toBe(400);
  });

  it("cancel deletes what was stored, and only for an open upload", async () => {
    const { id } = await initVisionDataset({ name: "cancel-me", destination: ws });
    await uploadVisionImages({ id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }] });
    await abortVisionDataset({ id, destination: ws });
    expect(tl.datasets.has("cancel-me")).toBe(false);
    tl.datasets.set("not-mine", new Map());
    expect((await fail(abortVisionDataset({ id: "not-mine", destination: ws }))).status).toBe(404);
    expect(tl.datasets.has("not-mine")).toBe(true);
  });
});

describe("image checks", () => {
  let n = 0;
  // The upload state lives for the process, so every test opens its own dataset.
  const open = async () => (await initVisionDataset({ name: `chk${++n}`, destination: ws })).id;
  const up = (id: string, relpath: string, bytes: Uint8Array) => uploadVisionImages({ id, destination: ws, images: [{ relpath, bytes }] });

  it("refuses paths outside images/, with .., or with a wrong extension", async () => {
    const id = await open();
    for (const bad of ["a.png", "images/../a.png", "/images/a.png", "images/a.gif", "images//a.png", "images\\a.png", "train.jsonl"]) {
      expect((await fail(up(id, bad, PNG))).status).toBe(400);
    }
    expect(tl.datasets.get(id)!.size).toBe(0);
  });

  it("checks the real type of the bytes against the name", async () => {
    const id = await open();
    expect((await fail(up(id, "images/a.png", new Uint8Array([1, 2, 3, 4])))).message).toContain("not a png, jpeg or webp");
    expect((await fail(up(id, "images/a.png", JPG))).message).toContain("name says otherwise");
    expect((await fail(up(id, "images/a.png", new Uint8Array()))).message).toContain("empty");
  });

  it("enforces the size limits from the environment (413)", async () => {
    const id = await open();
    process.env.VISION_IMAGE_MAX_BYTES = "10";
    expect((await fail(up(id, "images/a.png", PNG))).status).toBe(413);
    process.env.VISION_IMAGE_MAX_BYTES = "1000";
    process.env.VISION_DATASET_MAX_BYTES = "20";
    await up(id, "images/a.png", PNG);
    expect((await fail(up(id, "images/b.png", PNG))).status).toBe(413);
  });

  it("refuses an upload that was not opened by init", async () => {
    tl.datasets.set("existing", new Map());
    expect((await fail(up("existing", "images/a.png", PNG))).status).toBe(404);
    expect(tl.datasets.get("existing")!.size).toBe(0);
  });
});

describe("S3 upload", () => {
  it("uses prefix/<id>/{train.jsonl,eval.jsonl,images/...} and the s3:// ref", async () => {
    const { id, ref } = await initVisionDataset({ name: "pics", destination: bucket });
    expect(ref).toBe("s3://bkt/datasets/pics/");
    await uploadVisionImages({ id, destination: bucket, images: [{ relpath: "images/a.png", bytes: PNG }] });
    const r = await completeVisionDataset({ id, destination: bucket, train: rows(25), eval: rows(5) });
    expect(r.ref).toBe("s3://bkt/datasets/pics/");
    expect([...s3.objects.keys()].sort()).toEqual([
      "bkt/datasets/pics/eval.jsonl",
      "bkt/datasets/pics/images/a.png",
      "bkt/datasets/pics/train.jsonl",
    ]);
    expect(s3.objects.get("bkt/datasets/pics/images/a.png")).toBe(PNG);
  });

  it("refuses a prefix that already holds files, an unlisted bucket and a bad folder", async () => {
    s3.objects.set("bkt/datasets/old/train.jsonl", "x");
    expect((await fail(initVisionDataset({ name: "old", destination: bucket }))).status).toBe(409);
    expect((await fail(initVisionDataset({ name: "x", destination: { kind: "s3", bucket: "other", prefix: "d" } }))).message).toContain("not allowed");
    expect((await fail(initVisionDataset({ name: "x", destination: { kind: "s3", bucket: "bkt", prefix: "a/../b" } }))).status).toBe(400);
  });

  it("deletes everything when the JSONL is refused", async () => {
    const { id } = await initVisionDataset({ name: "bad", destination: bucket });
    await uploadVisionImages({ id, destination: bucket, images: [{ relpath: "images/a.png", bytes: PNG }] });
    await fail(completeVisionDataset({ id, destination: bucket, train: rows(25, "images/nope.png") }));
    expect(s3.objects.size).toBe(0);
  });

  it("refuses s3:// image references into a bucket the server may not read", async () => {
    const { id } = await initVisionDataset({ name: "leak", destination: ws });
    await uploadVisionImages({ id, destination: ws, images: [{ relpath: "images/a.png", bytes: PNG }] });
    const err = await fail(completeVisionDataset({ id, destination: ws, train: rows(25, "s3://secret/private/a.png") }));
    expect(err.message).toContain("not allowed");
    expect(tl.datasets.has("leak")).toBe(false);
    const ok = await initVisionDataset({ name: "fine", destination: ws });
    await completeVisionDataset({ id: ok.id, destination: ws, train: rows(25, "s3://bkt/shared/a.png") });
  });
});

describe("reading a stored dataset", () => {
  const seed = () => {
    tl.datasets.set("v", new Map<string, Uint8Array | string>([["train.jsonl", rows(3) + "\n"], ["images/a.png", PNG], ["images/evil.png", new Uint8Array([60, 104, 116, 109, 108])]]));
    tl.datasets.set("textonly", new Map<string, Uint8Array | string>([["x_train.jsonl", "{}\n"]]));
  };

  it("previews the first rows with image paths, and only for a vision dataset", async () => {
    seed();
    const p = await previewVisionDataset("v", 2);
    expect(p).toMatchObject({ vision: true, images: 2, rowsInPreview: 2, columns: ["image", "user", "assistant"] });
    expect(p!.rows[0]).toEqual({ image: "images/a.png", user: "Q0", assistant: "A0" });
    expect(await previewVisionDataset("textonly")).toBeNull();
    expect(await previewVisionDataset("missing")).toBeNull();
    expect(await previewVisionDataset("../etc")).toBeNull();
  });

  it("serves an image by its real type and refuses everything else", async () => {
    seed();
    expect(await readVisionImage("v", "images/a.png")).toMatchObject({ mime: "image/png" });
    expect(await readVisionImage("v", "images/evil.png")).toBeNull(); // not an image, whatever the name says
    expect(await readVisionImage("v", "train.jsonl")).toBeNull();
    expect(await readVisionImage("v", "images/../train.jsonl")).toBeNull();
    expect(await readVisionImage("v", "images/missing.png")).toBeNull();
    expect(await readVisionImage("..", "images/a.png")).toBeNull();
  });
});

describe("the fixture ZIP through the server (the Phase 3 gate)", () => {
  const files = async (drop?: string) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { unzipSync } = await import("fflate");
    const all = unzipSync(new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", "vision-dataset.zip"))));
    if (drop) delete all[drop];
    return all;
  };
  const send = async (name: string, dest: typeof ws | typeof bucket, all: Record<string, Uint8Array>) => {
    const { id } = await initVisionDataset({ name, destination: dest });
    const images = Object.entries(all).filter(([n]) => n.startsWith("images/")).map(([relpath, bytes]) => ({ relpath, bytes }));
    await uploadVisionImages({ id, destination: dest, images });
    return { id, train: new TextDecoder().decode(all["train.jsonl"]) };
  };

  it("a valid ZIP is stored in the workspace and on S3", async () => {
    const a = await send("fixture-ws", ws, await files());
    expect(await completeVisionDataset({ id: a.id, destination: ws, train: a.train })).toMatchObject({ kind: "vision", report: { valid: 25 }, images: { stored: 10, referenced: 10, unused: 0 } });
    expect(tl.datasets.get("fixture-ws")!.size).toBe(11);
    const b = await send("fixture-s3", bucket, await files());
    const r = await completeVisionDataset({ id: b.id, destination: bucket, train: b.train });
    expect(r.ref).toBe("s3://bkt/datasets/fixture-s3/");
    expect([...s3.objects.keys()].filter((k) => k.includes("fixture-s3")).length).toBe(11);
  });

  it("with one image removed the server refuses it and keeps nothing (workspace and S3)", async () => {
    const a = await send("broken-ws", ws, await files("images/3.png"));
    const e1 = await fail(completeVisionDataset({ id: a.id, destination: ws, train: a.train }));
    expect(e1.status).toBe(400);
    expect(e1.message).toContain("images/3.png");
    expect(tl.datasets.has("broken-ws")).toBe(false);
    const b = await send("broken-s3", bucket, await files("images/3.png"));
    await fail(completeVisionDataset({ id: b.id, destination: bucket, train: b.train }));
    expect([...s3.objects.keys()].filter((k) => k.includes("broken-s3"))).toEqual([]);
  });
});
