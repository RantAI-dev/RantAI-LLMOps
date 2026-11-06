import { describe, expect, it } from "vitest";

import { sessionTitle } from "./storage";

describe("sessionTitle", () => {
  it("uses the first 48 characters of the text", () => {
    expect(sessionTitle("halo dunia")).toBe("halo dunia");
    expect(sessionTitle("x".repeat(100))).toHaveLength(48);
  });
  it("reads the text part of an array", () => {
    expect(
      sessionTitle([
        { type: "image_url", image_url: { url: "/api/chat-images/" + "a".repeat(64) } },
        { type: "text", text: "apa ini?" },
      ]),
    ).toBe("apa ini?");
  });
  it("falls back to Image for a picture without a caption", () => {
    expect(sessionTitle([{ type: "image_url", image_url: { url: "/api/chat-images/" + "a".repeat(64) } }])).toBe("Image");
    expect(sessionTitle("   ")).toBe("Image");
  });
});
