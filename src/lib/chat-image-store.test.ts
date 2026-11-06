import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatImageError,
  chatImageDataUrl,
  chatImagesDir,
  pruneChatImages,
  readChatImage,
  referencedShas,
  resolveImageRefs,
  saveChatImage,
  sniffImageMime,
} from "@/lib/chat-image-store";

// Smallest valid-looking headers; the store sniffs magic numbers, it does not decode.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-img-"));
  vi.stubEnv("RANTAI_DATA_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("sniffImageMime", () => {
  it("recognises the four accepted types", () => {
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(GIF)).toBe("image/gif");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });
  it("rejects anything else", () => {
    expect(sniffImageMime(Buffer.from("<svg xmlns='x'/>"))).toBeNull();
    expect(sniffImageMime(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("saveChatImage / readChatImage", () => {
  it("stores by content hash and reads it back", async () => {
    const r = await saveChatImage(JPEG, "image/jpeg");
    expect(r.sha).toMatch(/^[a-f0-9]{64}$/);
    expect(r.ref).toBe(`/api/chat-images/${r.sha}`);
    const back = await readChatImage(r.sha);
    expect(back?.mime).toBe("image/jpeg");
    expect(back?.bytes.equals(JPEG)).toBe(true);
    expect((await chatImageDataUrl(r.sha))?.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("is idempotent for identical bytes and leaves no temp files", async () => {
    const a = await saveChatImage(PNG);
    const b = await saveChatImage(PNG);
    expect(b.sha).toBe(a.sha);
    const names = await fs.readdir(chatImagesDir());
    expect(names).toEqual([`${a.sha}.png`]);
  });

  it("rejects a declared MIME that is not an image type", async () => {
    await expect(saveChatImage(JPEG, "image/svg+xml")).rejects.toBeInstanceOf(ChatImageError);
  });
  it("rejects a declared MIME that contradicts the bytes", async () => {
    await expect(saveChatImage(PNG, "image/jpeg")).rejects.toThrow(/does not match/);
  });
  it("rejects bytes that are not an image at all", async () => {
    await expect(saveChatImage(Buffer.from("<html>"), "image/png")).rejects.toThrow(/png, jpeg/);
  });
  it("answers 413 for an oversize image", async () => {
    vi.stubEnv("CHAT_MAX_IMAGE_BYTES", "16");
    const big = Buffer.concat([JPEG, Buffer.alloc(32)]);
    await expect(saveChatImage(big)).rejects.toMatchObject({ status: 413 });
  });

  it("never reads outside the images directory", async () => {
    await fs.writeFile(path.join(dir, "secret.jpg"), JPEG);
    for (const bad of ["../secret", "../../etc/passwd", "a".repeat(63), "A".repeat(64), "", "x".repeat(64)]) {
      expect(await readChatImage(bad)).toBeNull();
    }
  });
});

describe("resolveImageRefs", () => {
  it("swaps references for data URLs and leaves other parts alone", async () => {
    const { ref } = await saveChatImage(JPEG);
    const r = await resolveImageRefs([
      { type: "text", text: "what is this?" },
      { type: "image_url", image_url: { url: ref } },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok || typeof r.content === "string") throw new Error("unexpected");
    expect(r.content[0]).toEqual({ type: "text", text: "what is this?" });
    expect((r.content[1] as { image_url: { url: string } }).image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect((r.content[2] as { image_url: { url: string } }).image_url.url).toBe("https://example.com/a.png");
  });
  it("passes a string through", async () => {
    expect(await resolveImageRefs("hi")).toEqual({ ok: true, content: "hi" });
  });
  it("reports a reference whose file is gone", async () => {
    const sha = "0".repeat(64);
    const r = await resolveImageRefs([{ type: "image_url", image_url: { url: `/api/chat-images/${sha}` } }]);
    expect(r).toEqual({ ok: false, missing: sha });
  });
});

describe("referencedShas", () => {
  it("finds refs anywhere in a conversation list", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const convs = [{ messages: [{ content: [{ type: "image_url", image_url: { url: `/api/chat-images/${a}` } }] }] }, { x: `see /api/chat-images/${b}` }];
    expect([...referencedShas(convs)].sort()).toEqual([a, b]);
  });
});

describe("pruneChatImages", () => {
  async function aged(bytes: Buffer, ageDays: number) {
    const { sha } = await saveChatImage(bytes);
    const f = path.join(chatImagesDir(), `${sha}.${bytes === PNG ? "png" : bytes === GIF ? "gif" : bytes === WEBP ? "webp" : "jpg"}`);
    const t = new Date(Date.now() - ageDays * DAY);
    await fs.utimes(f, t, t);
    return { sha, f };
  }
  const exists = (f: string) => fs.access(f).then(() => true, () => false);

  it("deletes old unreferenced images only", async () => {
    const used = await aged(JPEG, 30);
    const orphan = await aged(PNG, 30);
    const young = await aged(GIF, 2);
    const res = await pruneChatImages({
      listConversations: async () => [{ messages: [{ content: [{ image_url: { url: `/api/chat-images/${used.sha}` } }] }] }],
    });
    expect(res).toEqual({ deleted: 1, kept: 2 });
    expect(await exists(used.f)).toBe(true);
    expect(await exists(orphan.f)).toBe(false);
    expect(await exists(young.f)).toBe(true);
  });

  it("never deletes anything younger than 7 days, even if configured lower", async () => {
    const y = await aged(WEBP, 6);
    vi.stubEnv("CHAT_IMAGE_PRUNE_DAYS", "1");
    await pruneChatImages({ listConversations: async () => [] });
    await pruneChatImages({ minAgeDays: 0.1, listConversations: async () => [] });
    expect(await exists(y.f)).toBe(true);
  });

  it("fails closed when the conversations cannot be listed", async () => {
    const old = await aged(JPEG, 90);
    const a = await pruneChatImages({ listConversations: async () => null });
    expect(a.deleted).toBe(0);
    expect(a.skipped).toBeTruthy();
    const b = await pruneChatImages({
      listConversations: async () => {
        throw new Error("boom");
      },
    });
    expect(b.deleted).toBe(0);
    expect(await exists(old.f)).toBe(true);
  });

  it("is a no-op without an images directory", async () => {
    expect(await pruneChatImages({ listConversations: async () => [] })).toEqual({ deleted: 0, kept: 0 });
  });

  it("removes stale temp files but keeps fresh ones", async () => {
    await fs.mkdir(chatImagesDir(), { recursive: true });
    const stale = path.join(chatImagesDir(), "x.1.tmp");
    const fresh = path.join(chatImagesDir(), "y.2.tmp");
    await fs.writeFile(stale, "x");
    await fs.writeFile(fresh, "y");
    const old = new Date(Date.now() - 3 * DAY);
    await fs.utimes(stale, old, old);
    await pruneChatImages({ listConversations: async () => [] });
    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
  });
});
