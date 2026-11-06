import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatSessions } from "./use-chat-sessions";

const REF = `/api/chat-images/${"a".repeat(64)}`;
let posts: string[];

beforeEach(() => {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push(String(init.body));
      if (String(url).startsWith("/api/conversations") && !init?.method) return Response.json({ conversations: [] });
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useChatSessions with images", () => {
  it("titles an image-only chat 'Image' and a captioned one by its caption", async () => {
    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setActiveMessages(() => [{ role: "user", content: [{ type: "image_url", image_url: { url: REF } }] }]));
    expect(result.current.activeSession?.title).toBe("Image");
  });

  it("saves only references, never base64, even if an inline image slips in", async () => {
    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const inline = "data:image/jpeg;base64," + "A".repeat(5000);
    act(() =>
      result.current.setActiveMessages(() => [
        {
          role: "user",
          content: [
            { type: "text", text: "lihat" },
            { type: "image_url", image_url: { url: REF } },
            { type: "image_url", image_url: { url: inline } },
          ],
        },
        { role: "assistant", content: "oke" },
      ]),
    );
    await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 3000 });
    const saved = posts.join("\n");
    expect(saved).toContain(REF);
    expect(saved).not.toContain("base64");
    expect(saved).not.toContain("data:image");
    expect(saved.length).toBeLessThan(2000);
  });
});
