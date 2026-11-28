import { describe, expect, it } from "vitest";

import { answerText } from "@/modules/duo/components/chat/turn";
import { roomItems } from "@/modules/duo/components/rooms/duo-rooms";

describe("roomItems", () => {
  it("reads who asked from stored questions and the answer from its reply", () => {
    const items = roomItems([
      { role: "user", content: "[Ana] What is 2+2?", created_at: "2026-11-28T01:00:00Z" },
      { role: "assistant", content: "4", reply: { reasoning_mode: "fast", assurance: "verified", message: { role: "assistant", content: "4" } } },
      { role: "user", content: "no name prefix" },
    ]);
    expect(items[0]).toMatchObject({ kind: "q", who: "Ana", text: "What is 2+2?" });
    expect(items[1].kind).toBe("a");
    if (items[1].kind === "a") expect(answerText(items[1].turn)).toBe("4");
    expect(items[2]).toMatchObject({ kind: "q", who: "", text: "no name prefix" });
  });
});
