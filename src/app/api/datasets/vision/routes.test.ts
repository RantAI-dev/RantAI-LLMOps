// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The routes are thin: this checks the HTTP layer (request shape, limits, status codes, headers). What gets
// stored is covered by src/lib/vision-dataset.test.ts with a fake Transformer Lab.
const lib = vi.hoisted(() => ({
  uploadVisionImages: vi.fn(),
  initVisionDataset: vi.fn(),
  completeVisionDataset: vi.fn(),
  abortVisionDataset: vi.fn(),
  readVisionImage: vi.fn(),
  denied: null as Response | null,
}));
vi.mock("@/lib/auth", () => ({ guardApi: vi.fn(async () => lib.denied) }));
vi.mock("@/lib/vision-dataset", () => {
  class VisionUploadError extends Error {
    constructor(
      message: string,
      public readonly status: number = 400
    ) {
      super(message);
    }
  }
  return {
    VisionUploadError,
    uploadVisionImages: lib.uploadVisionImages,
    initVisionDataset: lib.initVisionDataset,
    completeVisionDataset: lib.completeVisionDataset,
    abortVisionDataset: lib.abortVisionDataset,
    readVisionImage: lib.readVisionImage,
    destinationFrom: (get: (k: string) => string | null | undefined) =>
      get("destination") === "s3" ? { kind: "s3", bucket: get("bucket") ?? "", prefix: get("prefix") ?? "datasets" } : { kind: "workspace" },
    visionErrorResponse: (err: unknown) =>
      Response.json({ error: (err as Error).message }, { status: err instanceof VisionUploadError ? err.status : 502 }),
  };
});

import { POST as completeRoute } from "@/app/api/datasets/vision/[id]/complete/route";
import { POST as filesRoute } from "@/app/api/datasets/vision/[id]/files/route";
import { GET as imageRoute } from "@/app/api/datasets/vision/[id]/image/route";
import { DELETE as deleteRoute } from "@/app/api/datasets/vision/[id]/route";
import { POST as initRoute } from "@/app/api/datasets/vision/init/route";
import { VisionUploadError } from "@/lib/vision-dataset";

const ctx = (id = "my-ds") => ({ params: Promise.resolve({ id }) });
const req = (path: string, init?: RequestInit) => new NextRequest(`http://localhost${path}`, init);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

beforeEach(() => {
  Object.values(lib).forEach((f) => typeof f === "function" && "mockReset" in f && f.mockReset());
  lib.denied = null;
});

describe("init", () => {
  it("passes the name and destination on and returns {id, ref}", async () => {
    lib.initVisionDataset.mockResolvedValue({ id: "x", ref: "s3://b/d/x/" });
    const res = await initRoute(req("/api/datasets/vision/init", { method: "POST", body: JSON.stringify({ name: "X", destination: "s3", bucket: "b", prefix: "d" }) }));
    expect(await res.json()).toEqual({ id: "x", ref: "s3://b/d/x/" });
    expect(lib.initVisionDataset).toHaveBeenCalledWith({ name: "X", destination: { kind: "s3", bucket: "b", prefix: "d" } });
  });
  it("maps a taken name to 409 and a bad body to 400, and honours the auth guard", async () => {
    lib.initVisionDataset.mockRejectedValue(new VisionUploadError("exists", 409));
    expect((await initRoute(req("/api/datasets/vision/init", { method: "POST", body: JSON.stringify({ name: "X" }) }))).status).toBe(409);
    expect((await initRoute(req("/api/datasets/vision/init", { method: "POST", body: "nope" }))).status).toBe(400);
    lib.denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    expect((await initRoute(req("/api/datasets/vision/init", { method: "POST", body: "{}" }))).status).toBe(401);
    expect(lib.initVisionDataset).toHaveBeenCalledTimes(1);
  });
});

describe("files", () => {
  const batch = (pairs: Array<[string, Uint8Array]>) => {
    const form = new FormData();
    for (const [rel, bytes] of pairs) {
      form.append("relpath", rel);
      form.append("file", new Blob([bytes as BlobPart]), "x");
    }
    return form;
  };

  it("pairs each relpath with its file and forwards the destination from the query", async () => {
    lib.uploadVisionImages.mockResolvedValue({ stored: 2, bytes: 18 });
    const res = await filesRoute(req("/api/datasets/vision/my-ds/files?destination=s3&bucket=bkt&prefix=p", { method: "POST", body: batch([["images/a.png", PNG], ["images/b.png", PNG]]) }), ctx());
    expect(res.status).toBe(200);
    const arg = lib.uploadVisionImages.mock.calls[0]![0] as { id: string; destination: unknown; images: Array<{ relpath: string; bytes: Uint8Array }> };
    expect(arg.id).toBe("my-ds");
    expect(arg.destination).toEqual({ kind: "s3", bucket: "bkt", prefix: "p" });
    expect(arg.images.map((i) => i.relpath)).toEqual(["images/a.png", "images/b.png"]);
    expect([...arg.images[0]!.bytes]).toEqual([...PNG]);
  });

  it("refuses a request whose declared size is over 20 MB (+ envelope) with 413, before reading it", async () => {
    const r = req("/api/datasets/vision/my-ds/files", { method: "POST", body: batch([["images/a.png", PNG]]), headers: { "content-length": String(23 * 1024 * 1024) } });
    expect((await filesRoute(r, ctx())).status).toBe(413);
    expect(lib.uploadVisionImages).not.toHaveBeenCalled();
  });

  it("refuses files that add up to more than 20 MB even without a content-length", async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    const res = await filesRoute(req("/api/datasets/vision/my-ds/files", { method: "POST", body: batch([["images/a.png", big], ["images/b.png", big]]) }), ctx());
    expect(res.status).toBe(413);
    expect(lib.uploadVisionImages).not.toHaveBeenCalled();
  });

  it("needs one relpath per file, and a multipart body", async () => {
    const form = batch([["images/a.png", PNG]]);
    form.append("file", new Blob([PNG as BlobPart]), "y");
    expect((await filesRoute(req("/api/datasets/vision/my-ds/files", { method: "POST", body: form }), ctx())).status).toBe(400);
    expect((await filesRoute(req("/api/datasets/vision/my-ds/files", { method: "POST", body: "plain", headers: { "content-type": "text/plain" } }), ctx())).status).toBe(400);
  });

  it("passes the server's verdict through (a bad path is 400)", async () => {
    lib.uploadVisionImages.mockRejectedValue(new VisionUploadError("images/../a.png: relpath has an empty, \".\" or \"..\" segment", 400));
    const res = await filesRoute(req("/api/datasets/vision/my-ds/files", { method: "POST", body: batch([["images/../a.png", PNG]]) }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("..");
  });
});

describe("complete", () => {
  it("sends train, eval and name to the validator and returns its result", async () => {
    lib.completeVisionDataset.mockResolvedValue({ id: "my-ds", ref: "my-ds", kind: "vision" });
    const form = new FormData();
    form.append("name", "My DS");
    form.append("train", new Blob(['{"a":1}\n']), "train.jsonl");
    form.append("eval", new Blob(['{"b":2}\n']), "eval.jsonl");
    const res = await completeRoute(req("/api/datasets/vision/my-ds/complete", { method: "POST", body: form }), ctx());
    expect(await res.json()).toMatchObject({ kind: "vision" });
    expect(lib.completeVisionDataset).toHaveBeenCalledWith({ id: "my-ds", name: "My DS", destination: { kind: "workspace" }, train: '{"a":1}\n', eval: '{"b":2}\n' });
  });

  it("answers 400 with the reason when the dataset is refused, and 400 without a train file", async () => {
    lib.completeVisionDataset.mockRejectedValue(new VisionUploadError("1 image that is used by the train.jsonl is not in the dataset: images/x.png.", 400));
    const form = new FormData();
    form.append("train", new Blob(["x"]), "train.jsonl");
    const res = await completeRoute(req("/api/datasets/vision/my-ds/complete", { method: "POST", body: form }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("images/x.png");
    const none = new FormData();
    none.append("name", "x");
    expect((await completeRoute(req("/api/datasets/vision/my-ds/complete", { method: "POST", body: none }), ctx())).status).toBe(400);
  });
});

describe("cancel", () => {
  it("deletes an open upload", async () => {
    lib.abortVisionDataset.mockResolvedValue(undefined);
    const res = await deleteRoute(req("/api/datasets/vision/my-ds?destination=s3&bucket=b&prefix=p", { method: "DELETE" }), ctx());
    expect(await res.json()).toEqual({ ok: true });
    expect(lib.abortVisionDataset).toHaveBeenCalledWith({ id: "my-ds", destination: { kind: "s3", bucket: "b", prefix: "p" } });
  });
  it("is 404 when nothing is open", async () => {
    lib.abortVisionDataset.mockRejectedValue(new VisionUploadError("not open", 404));
    expect((await deleteRoute(req("/api/datasets/vision/other", { method: "DELETE" }), ctx("other"))).status).toBe(404);
  });
});

describe("image", () => {
  it("serves the bytes with the sniffed type and locked-down headers", async () => {
    lib.readVisionImage.mockResolvedValue({ bytes: PNG, mime: "image/png" });
    const res = await imageRoute(req("/api/datasets/vision/my-ds/image?path=images%2Fa.png"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);
    expect(lib.readVisionImage).toHaveBeenCalledWith("my-ds", "images/a.png");
  });
  it("is 404 for anything the reader refuses (and when it throws), and honours the auth guard", async () => {
    lib.readVisionImage.mockResolvedValue(null);
    expect((await imageRoute(req("/api/datasets/vision/my-ds/image?path=images%2F..%2Fx.png"), ctx())).status).toBe(404);
    lib.readVisionImage.mockRejectedValue(new Error("tl down"));
    expect((await imageRoute(req("/api/datasets/vision/my-ds/image?path=images%2Fa.png"), ctx())).status).toBe(404);
    lib.denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    expect((await imageRoute(req("/api/datasets/vision/my-ds/image?path=images%2Fa.png"), ctx())).status).toBe(401);
  });
});
