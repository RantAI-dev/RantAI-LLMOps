import { afterEach, describe, expect, it, vi } from "vitest";

import { exportModelWithProgress } from "@/lib/export-progress";

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("exportModelWithProgress", () => {
  it("returns the Ollama tag of a text export and forwards stages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([{ stage: "Merging", percent: null }, { done: true, tag: "rantai-x-1" }])));
    const stages: string[] = [];
    await expect(exportModelWithProgress("job", (s) => stages.push(s))).resolves.toEqual({ tag: "rantai-x-1" });
    expect(stages).toEqual(["Merging"]);
  });

  it("returns the llama.cpp files of a vision-language export, with no tag", async () => {
    const vl = { gguf: "/m/t.q8_0.gguf", mmproj: "/m/mmproj-t.f16.gguf", command: "llama-server -m /m/t.q8_0.gguf --mmproj /m/mmproj-t.f16.gguf" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([{ done: true, tag: "", vl }])));
    await expect(exportModelWithProgress("job", () => {})).resolves.toEqual({ tag: "", vl });
  });

  it("rejects with the server's error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([{ error: "merge failed" }])));
    await expect(exportModelWithProgress("job", () => {})).rejects.toThrow("merge failed");
  });
});
