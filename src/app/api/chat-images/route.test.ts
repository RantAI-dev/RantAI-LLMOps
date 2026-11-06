// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/chat-images/route";
import { GET } from "@/app/api/chat-images/[sha]/route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-img-route-"));
  vi.stubEnv("RANTAI_DATA_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

const postJson = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/chat-images", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const postFile = (bytes: Buffer, type: string) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "x", { type }));
  return POST(new NextRequest("http://localhost/api/chat-images", { method: "POST", body: form }));
};
const get = (sha: string) =>
  GET(new NextRequest(`http://localhost/api/chat-images/${sha}`), { params: Promise.resolve({ sha }) });

describe("POST /api/chat-images", () => {
  it("stores a data URL and the image can be fetched back", async () => {
    const res = await postJson({ dataUrl: `data:image/jpeg;base64,${JPEG.toString("base64")}` });
    expect(res.status).toBe(200);
    const { ref, sha } = (await res.json()) as { ref: string; sha: string };
    expect(ref).toBe(`/api/chat-images/${sha}`);

    const img = await get(sha);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await img.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it("stores a multipart file", async () => {
    const res = await postFile(PNG, "image/png");
    expect(res.status).toBe(200);
    const { sha } = (await res.json()) as { sha: string };
    expect((await get(sha)).headers.get("content-type")).toBe("image/png");
  });

  it("refuses a MIME that is not an image, or that lies about the bytes", async () => {
    expect((await postFile(Buffer.from("<svg/>"), "image/svg+xml")).status).toBe(400);
    expect((await postFile(PNG, "image/jpeg")).status).toBe(400);
    expect((await postJson({ dataUrl: "data:text/html;base64,PGI+" })).status).toBe(400);
    expect((await postJson({})).status).toBe(400);
    expect((await postJson("{nope")).status).toBe(400);
  });

  it("answers 413 for an oversize image, by header or by size", async () => {
    vi.stubEnv("CHAT_MAX_IMAGE_BYTES", "8");
    expect((await postJson({}, { "content-length": String(50 * 1024 * 1024) })).status).toBe(413);
    expect((await postJson({ dataUrl: `data:image/jpeg;base64,${JPEG.toString("base64")}` })).status).toBe(413);
  });
});

describe("GET /api/chat-images/[sha]", () => {
  it("404s on malformed hashes and traversal, without touching the disk", async () => {
    for (const bad of ["..", "../secret", "abc", "A".repeat(64), `${"a".repeat(63)}/`, ""]) {
      expect((await get(bad)).status).toBe(404);
    }
  });
  it("404s on an unknown hash", async () => {
    expect((await get("a".repeat(64))).status).toBe(404);
  });
});
