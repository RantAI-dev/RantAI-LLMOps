import { describe, expect, it, vi } from "vitest";

import { VisionClientError, uploadVisionDataset } from "@/modules/datasets/lib/vision-upload";

type Call = { url: string; method: string; body?: BodyInit | null };

/** A fake server: records calls, answers like the real routes. */
function fakeFetch(opts: { failFilesWith?: number[]; completeStatus?: number } = {}) {
  const calls: Call[] = [];
  const failFiles = [...(opts.failFilesWith ?? [])];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body });
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (u === "/api/datasets/vision/init") return Response.json({ id: "my-ds", ref: "my-ds" });
    if (/\/files(\?|$)/.test(u)) {
      const status = failFiles.shift();
      return status ? Response.json({ error: `server said ${status}` }, { status }) : Response.json({ stored: 1 });
    }
    if (/\/complete(\?|$)/.test(u)) {
      return (opts.completeStatus ?? 200) === 200
        ? Response.json({ id: "my-ds", ref: "my-ds", kind: "vision", images: { stored: 3, referenced: 3, unused: 0 } })
        : Response.json({ error: "1 image that is used by the train.jsonl is not in the dataset: images/x.png." }, { status: opts.completeStatus });
    }
    if (init?.method === "DELETE") return Response.json({ ok: true });
    return new Response("?", { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

const MB = 1024 * 1024;
const images = (n: number, size: number) => Array.from({ length: n }, (_, i) => ({ path: `images/${i}.png`, size }));
const base = (over: Partial<Parameters<typeof uploadVisionDataset>[0]> = {}) => ({
  name: "My DS",
  destination: { kind: "workspace" } as const,
  images: images(3, 1000),
  readImages: (paths: string[]) => Object.fromEntries(paths.map((p) => [p, new Uint8Array([1, 2, 3])])),
  trainText: '{"messages":[]}\n',
  ...over,
});

describe("uploadVisionDataset", () => {
  it("runs init, the image batches and complete, in order", async () => {
    const { f, calls } = fakeFetch();
    const progress: number[] = [];
    // 5 images of 8 MB: batches of 16 MB allow two per request -> 3 requests.
    const r = await uploadVisionDataset(base({ images: images(5, 8 * MB), fetchImpl: f, onProgress: (p) => progress.push(p.pct) }));
    expect(r).toMatchObject({ id: "my-ds", ref: "my-ds", images: { stored: 3 } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/datasets/vision/init",
      "POST /api/datasets/vision/my-ds/files",
      "POST /api/datasets/vision/my-ds/files",
      "POST /api/datasets/vision/my-ds/files",
      "POST /api/datasets/vision/my-ds/complete",
    ]);
    const first = calls[1]!.body as FormData;
    expect(first.getAll("relpath")).toEqual(["images/0.png", "images/1.png"]);
    expect(first.getAll("file")).toHaveLength(2);
    const done = calls[4]!.body as FormData;
    expect(done.get("name")).toBe("My DS");
    expect((done.get("train") as File).name).toBe("train.jsonl");
    expect(done.get("eval")).toBeNull();
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress.some((p) => p > 0 && p < 100)).toBe(true);
  });

  it("sends eval.jsonl and the S3 destination on every call after init", async () => {
    const { f, calls } = fakeFetch();
    await uploadVisionDataset(base({ fetchImpl: f, evalText: '{"a":1}\n', destination: { kind: "s3", bucket: "bkt", prefix: "d/x" } }));
    const init = JSON.parse(String(calls[0]!.body)) as Record<string, string>;
    expect(init).toMatchObject({ name: "My DS", destination: "s3", bucket: "bkt", prefix: "d/x" });
    expect(calls[1]!.url).toBe("/api/datasets/vision/my-ds/files?destination=s3&bucket=bkt&prefix=d%2Fx");
    expect((calls[calls.length - 1]!.body as FormData).get("eval")).toBeInstanceOf(File);
  });

  it("retries a batch after a 5xx and gives up on a 4xx at once, deleting what was stored", async () => {
    const a = fakeFetch({ failFilesWith: [502] });
    await uploadVisionDataset(base({ fetchImpl: a.f }));
    expect(a.calls.filter((c) => c.url.endsWith("/files")).length).toBe(2);

    const b = fakeFetch({ failFilesWith: [400] });
    await expect(uploadVisionDataset(base({ fetchImpl: b.f }))).rejects.toThrow("server said 400");
    expect(b.calls.filter((c) => c.url.endsWith("/files")).length).toBe(1);
    expect(b.calls[b.calls.length - 1]).toMatchObject({ method: "DELETE", url: "/api/datasets/vision/my-ds" });

    const c = fakeFetch({ failFilesWith: [503, 503, 503] });
    await expect(uploadVisionDataset(base({ fetchImpl: c.f, retries: 2 }))).rejects.toThrow("server said 503");
    expect(c.calls.filter((x) => x.url.endsWith("/files")).length).toBe(3);
  });

  it("surfaces the server's reason when complete refuses, and cleans up", async () => {
    const { f, calls } = fakeFetch({ completeStatus: 400 });
    await expect(uploadVisionDataset(base({ fetchImpl: f }))).rejects.toThrow(/is not in the dataset: images\/x\.png/);
    expect(calls[calls.length - 1]!.method).toBe("DELETE");
  });

  it("stops when cancelled and calls DELETE", async () => {
    const { f, calls } = fakeFetch();
    const ctl = new AbortController();
    const reads: string[][] = [];
    const run = uploadVisionDataset(
      base({
        images: images(5, 8 * MB),
        fetchImpl: f,
        signal: ctl.signal,
        readImages: (paths) => {
          reads.push(paths);
          ctl.abort(); // the user presses Cancel while the first batch is being read
          return Object.fromEntries(paths.map((p) => [p, new Uint8Array([1])]));
        },
      })
    );
    await expect(run).rejects.toMatchObject({ cancelled: true });
    await expect(run).rejects.toBeInstanceOf(VisionClientError);
    expect(reads).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/complete")).length).toBe(0);
    expect(calls[calls.length - 1]).toMatchObject({ method: "DELETE" });
  });

  it("does not create anything when init is refused (name taken)", async () => {
    const f = vi.fn(async () => Response.json({ error: 'Dataset "my-ds" already exists.' }, { status: 409 }));
    await expect(uploadVisionDataset(base({ fetchImpl: f as unknown as typeof fetch }))).rejects.toThrow(/already exists/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
