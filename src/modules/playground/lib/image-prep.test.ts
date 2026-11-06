import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/modules/playground/types";

import { attachError, buildUserContent, capHistoryImages, fitWithin, persistableMessages, visionOf } from "./image-prep";

const img = (url: string) => ({ type: "image_url" as const, image_url: { url } });
const REF = (c: string) => `/api/chat-images/${c.repeat(64)}`;

describe("fitWithin", () => {
  it("leaves small images alone and never scales up", () => {
    expect(fitWithin(320, 120)).toEqual({ width: 320, height: 120 });
    expect(fitWithin(1280, 800)).toEqual({ width: 1280, height: 800 });
  });
  it("scales the longest side to 1280, keeping the ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 960, height: 1280 });
    expect(fitWithin(10000, 1)).toEqual({ width: 1280, height: 1 });
  });
});

describe("attachError", () => {
  it("accepts the four image types", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(attachError({ type, size: 1000 }, 0)).toBeNull();
    }
  });
  it("refuses other types, with the file name", () => {
    expect(attachError({ type: "application/pdf", size: 10, name: "a.pdf" }, 0)).toMatch(/a\.pdf is not a PNG/);
  });
  it("refuses a fifth image per message", () => {
    expect(attachError({ type: "image/png", size: 1 }, 3)).toBeNull();
    expect(attachError({ type: "image/png", size: 1 }, 4)).toMatch(/at most 4 images/);
  });
  it("refuses a huge source file", () => {
    expect(attachError({ type: "image/jpeg", size: 40 * 1024 * 1024, name: "big.jpg" }, 0)).toMatch(/too large/);
  });
});

describe("buildUserContent", () => {
  it("keeps text-only as a plain string", () => {
    expect(buildUserContent("halo", [])).toBe("halo");
  });
  it("builds parts for text plus images, text first", () => {
    expect(buildUserContent("apa ini?", [REF("a"), REF("b")])).toEqual([
      { type: "text", text: "apa ini?" },
      img(REF("a")),
      img(REF("b")),
    ]);
  });
  it("sends images without a caption as image parts only", () => {
    expect(buildUserContent("", [REF("a")])).toEqual([img(REF("a"))]);
  });
});

describe("capHistoryImages", () => {
  const user = (...refs: string[]): ChatMessage => ({ role: "user", content: buildUserContent("q", refs) });

  it("returns the very same array when under the limit", () => {
    const msgs = [user(REF("a")), { role: "assistant", content: "x" } as ChatMessage];
    expect(capHistoryImages(msgs, 8)).toBe(msgs);
  });
  it("drops the OLDEST images over the limit and keeps the newest", () => {
    const msgs = [user(REF("a"), REF("b")), user(REF("c")), user(REF("d"))];
    const out = capHistoryImages(msgs, 2);
    const sent = JSON.stringify(out);
    expect(sent).not.toContain(REF("a"));
    expect(sent).not.toContain(REF("b"));
    expect(sent).toContain(REF("c"));
    expect(sent).toContain(REF("d"));
    expect(sent).toContain("[earlier image omitted]");
    // The saved history is not touched.
    expect(JSON.stringify(msgs)).toContain(REF("a"));
  });
});

describe("persistableMessages", () => {
  it("passes references and text through untouched", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: buildUserContent("hi", [REF("a")]) }, { role: "assistant", content: "ok" }];
    expect(persistableMessages(msgs)).toEqual(msgs);
  });
  it("never lets an inline data URL through", () => {
    const b64 = "data:image/jpeg;base64," + "A".repeat(4000);
    const out = persistableMessages([{ role: "user", content: [{ type: "text", text: "x" }, img(b64), img(REF("a"))] }]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("base64");
    expect(json).toContain(REF("a"));
  });
});

describe("visionOf", () => {
  const engines = [
    { id: "ollama", models: [{ id: "qwen2.5:0.5b", vision: false }, { id: "llava:latest", vision: true }, { id: "old:1b" }] },
    { id: "vllm", models: [{ id: "base", vision: true }] },
  ];
  it("is false only when the engine says so", () => {
    expect(visionOf(engines, "ollama", "qwen2.5:0.5b")).toBe(false);
    expect(visionOf(engines, "ollama", "llava")).toBe(true);
    expect(visionOf(engines, "ollama", "old:1b")).toBeUndefined();
    expect(visionOf(engines, "ollama", "ghost")).toBeUndefined();
    expect(visionOf(engines, "vllm", "base")).toBe(true);
    expect(visionOf([], "ollama", "x")).toBeUndefined();
  });
});
