// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// s3.ts reads its configuration when it is imported, so each test sets the environment first and imports fresh.
const fetchMock = vi.fn();

async function load() {
  vi.resetModules();
  vi.stubEnv("S3_ENDPOINT_URL", "http://minio.test:9000");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "key");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("S3_ALLOWED_BUCKETS", "bkt");
  return import("@/lib/s3");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("putObject", () => {
  it("sends a string as UTF-8 with an explicit Content-Length (as before)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const { putObject } = await load();
    expect(await putObject("bkt", "a/train.jsonl", "héllo\n")).toBe("s3://bkt/a/train.jsonl");
    const req = fetchMock.mock.calls[0]![0] as Request;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("http://minio.test:9000/bkt/a/train.jsonl");
    expect(req.headers.get("content-length")).toBe(String(new TextEncoder().encode("héllo\n").byteLength));
    expect(req.headers.get("content-type")).toBe("application/jsonl");
    expect(req.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
  });

  it("sends a Uint8Array byte for byte, with its own content type", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const { putObject } = await load();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128]);
    await putObject("bkt", "d/images/a b.png", bytes, "image/png");
    const req = fetchMock.mock.calls[0]![0] as Request;
    expect(req.url).toBe("http://minio.test:9000/bkt/d/images/a%20b.png");
    expect(req.headers.get("content-length")).toBe("7");
    expect(req.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await req.arrayBuffer())).toEqual(bytes);
  });

  it("refuses a bucket outside the allowlist and reports a failed upload", async () => {
    const { putObject } = await load();
    await expect(putObject("other", "k", "x")).rejects.toThrow(/not allowed/);
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(putObject("bkt", "k", new Uint8Array([1]))).rejects.toThrow(/403/);
  });
});

describe("listObjects / deleteObject", () => {
  it("lists every page of a prefix and decodes XML entities in keys", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken>" +
            "<Contents><Key>d/x/images/a&amp;b.png</Key><Size>10</Size></Contents></ListBucketResult>"
        )
      )
      .mockResolvedValueOnce(new Response("<ListBucketResult><Contents><Key>d/x/train.jsonl</Key><Size>5</Size></Contents></ListBucketResult>"));
    const { listObjects } = await load();
    expect(await listObjects("bkt", "d/x/")).toEqual([
      { key: "d/x/images/a&b.png", size: 10 },
      { key: "d/x/train.jsonl", size: 5 },
    ]);
    const first = new URL((fetchMock.mock.calls[0]![0] as Request).url);
    expect(first.searchParams.get("prefix")).toBe("d/x/");
    expect(new URL((fetchMock.mock.calls[1]![0] as Request).url).searchParams.get("continuation-token")).toBe("tok&1");
  });

  it("deletes an object and treats 404 as done", async () => {
    const { deleteObject } = await load();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response("", { status: 404 }));
    await deleteObject("bkt", "k");
    await deleteObject("bkt", "k");
    expect((fetchMock.mock.calls[0]![0] as Request).method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(deleteObject("bkt", "k")).rejects.toThrow(/403/);
  });
});
