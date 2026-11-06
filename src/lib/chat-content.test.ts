import { describe, expect, it } from "vitest";
import {
  chatLimits,
  hasImages,
  imageRefSha,
  imagesOf,
  isPublicHttpsUrl,
  mapImageUrls,
  normalizeContent,
  parseImageDataUrl,
  textOf,
  validateContent,
  validateMessages,
  type ChatLimits,
  type ContentPart,
} from "./chat-content";

// 1x1 transparent PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const img = (url: string): ContentPart => ({ type: "image_url", image_url: { url } });
const txt = (text: string): ContentPart => ({ type: "text", text });
const limits: ChatLimits = { maxImagesPerMessage: 2, maxImagesPerRequest: 3, maxImageBytes: 100, maxBodyBytes: 1000 };
const SHA = "a".repeat(64);

describe("textOf / imagesOf / hasImages", () => {
  it("handles strings, arrays and empty values", () => {
    expect(textOf("hi")).toBe("hi");
    expect(textOf([txt("a"), img(PNG), txt("b")])).toBe("a\nb");
    expect(textOf(undefined)).toBe("");
    expect(textOf(null)).toBe("");
    expect(imagesOf("hi")).toEqual([]);
    expect(imagesOf([txt("a"), img(PNG)])).toHaveLength(1);
    expect(hasImages([img(PNG)])).toBe(true);
    expect(hasImages([txt("a")])).toBe(false);
  });
});

describe("normalizeContent", () => {
  it("keeps strings and collapses text-only arrays to a string (engines see the old shape)", () => {
    expect(normalizeContent("hi")).toBe("hi");
    expect(normalizeContent([txt("a"), txt("b")])).toBe("a\nb");
  });
  it("keeps an array that has images and drops empty text parts", () => {
    expect(normalizeContent([txt(""), img(PNG), txt("q")])).toEqual([img(PNG), txt("q")]);
  });
});

describe("mapImageUrls", () => {
  it("rewrites only image URLs", () => {
    const out = mapImageUrls([img("/api/chat-images/" + SHA), txt("q")], () => PNG);
    expect(out).toEqual([img(PNG), txt("q")]);
    expect(mapImageUrls("plain", () => "x")).toBe("plain");
  });
});

describe("imageRefSha", () => {
  it("accepts a 64-hex reference and nothing else", () => {
    expect(imageRefSha("/api/chat-images/" + SHA)).toBe(SHA);
    expect(imageRefSha("/api/chat-images/../etc/passwd")).toBeNull();
    expect(imageRefSha("/api/chat-images/" + "A".repeat(64))).toBeNull();
    expect(imageRefSha("/api/chat-images/" + "a".repeat(63))).toBeNull();
    expect(imageRefSha("https://x.io/api/chat-images/" + SHA)).toBeNull();
  });
});

describe("parseImageDataUrl", () => {
  it("reports MIME and decoded size", () => {
    expect(parseImageDataUrl(PNG)).toEqual({ mime: "image/png", bytes: 70 });
    expect(parseImageDataUrl("data:image/jpeg;base64,QUJD")).toEqual({ mime: "image/jpeg", bytes: 3 });
    expect(parseImageDataUrl("data:image/jpeg;base64,QUI=")).toEqual({ mime: "image/jpeg", bytes: 2 });
    expect(parseImageDataUrl("data:image/jpeg;base64,QQ==")).toEqual({ mime: "image/jpeg", bytes: 1 });
  });
  it("rejects other types, bad base64 and bad padding", () => {
    expect(parseImageDataUrl("data:image/svg+xml;base64,QUJD")).toBeNull();
    expect(parseImageDataUrl("data:text/html;base64,QUJD")).toBeNull();
    expect(parseImageDataUrl("data:image/png;base64,QU JD")).toBeNull();
    expect(parseImageDataUrl("data:image/png;base64,QUJ")).toBeNull();
    expect(parseImageDataUrl("data:image/png,QUJD")).toBeNull();
  });
});

describe("isPublicHttpsUrl", () => {
  it("allows a public https host", () => {
    expect(isPublicHttpsUrl("https://upload.wikimedia.org/a.png")).toBe(true);
    expect(isPublicHttpsUrl("https://8.8.8.8/a.png")).toBe(true);
  });
  it("refuses everything the engine must not fetch", () => {
    for (const u of [
      "http://example.com/a.png",
      "file:///etc/passwd",
      "https://localhost/a.png",
      "https://rantai-backend/a.png",
      "https://host.internal/a.png",
      "https://printer.local/a.png",
      "https://127.0.0.1/a.png",
      "https://10.1.2.3/a.png",
      "https://172.20.0.5/a.png",
      "https://192.168.1.1/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://100.100.1.1/a.png",
      "https://[::1]/a.png",
      "https://user:pw@example.com/a.png",
      "/relative.png",
      "not a url",
    ]) {
      expect(isPublicHttpsUrl(u), u).toBe(false);
    }
  });
});

describe("validateContent", () => {
  it("accepts strings, text arrays, data URLs, stored refs and public https", () => {
    expect(validateContent("hi", limits)).toEqual({ ok: true });
    expect(validateContent([txt("a")], limits)).toEqual({ ok: true });
    expect(validateContent([img(PNG), txt("q")], { ...limits, maxImageBytes: 1000 })).toEqual({ ok: true });
    expect(validateContent([img("/api/chat-images/" + SHA)], limits)).toEqual({ ok: true });
    expect(validateContent([img("https://example.com/a.png")], limits)).toEqual({ ok: true });
  });
  it("rejects wrong shapes with 400", () => {
    expect(validateContent(42, limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent({ type: "text" }, limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent([{ type: "audio" }], limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent([{ type: "text", text: 5 }], limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent([{ type: "image_url" }], limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent([null], limits)).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects bad image URLs with 400", () => {
    expect(validateContent([img("file:///etc/passwd")], limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent([img("http://example.com/a.png")], limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent([img("data:image/svg+xml;base64,QUJD")], limits)).toMatchObject({ ok: false, status: 400 });
    expect(validateContent([img("/api/chat-images/nothex")], limits)).toMatchObject({ ok: false, status: 400 });
  });
  it("answers 413 for an image over the byte limit and 400 for too many", () => {
    expect(validateContent([img(PNG)], { ...limits, maxImageBytes: 50 })).toMatchObject({ ok: false, status: 413 });
    expect(validateContent([img(PNG), img(PNG), img(PNG)], { ...limits, maxImageBytes: 1000 })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("validateMessages", () => {
  const L = { ...limits, maxImageBytes: 1000 };
  it("needs a non-empty array of messages with roles", () => {
    expect(validateMessages(undefined, L)).toMatchObject({ ok: false });
    expect(validateMessages([], L)).toMatchObject({ ok: false });
    expect(validateMessages([{ content: "x" }], L)).toMatchObject({ ok: false });
    expect(validateMessages([{ role: "user", content: "x" }], L)).toEqual({ ok: true });
  });
  it("caps images per request across messages", () => {
    const m = { role: "user", content: [img(PNG), img(PNG)] };
    expect(validateMessages([m], L)).toEqual({ ok: true });
    expect(validateMessages([m, m], L)).toMatchObject({ ok: false, status: 400 });
  });
  it("surfaces a content error from any message", () => {
    expect(
      validateMessages([{ role: "user", content: "ok" }, { role: "user", content: [img("file:///x")] }], L),
    ).toMatchObject({ ok: false, status: 400 });
  });
});

describe("chatLimits", () => {
  it("has defaults and reads env overrides, ignoring junk", () => {
    expect(chatLimits({})).toEqual({
      maxImagesPerMessage: 4,
      maxImagesPerRequest: 8,
      maxImageBytes: 8 * 1024 * 1024,
      maxBodyBytes: 24 * 1024 * 1024,
    });
    expect(chatLimits({ CHAT_MAX_IMAGES_PER_MESSAGE: "2", CHAT_MAX_BODY_BYTES: "junk" })).toMatchObject({
      maxImagesPerMessage: 2,
      maxBodyBytes: 24 * 1024 * 1024,
    });
  });
});
