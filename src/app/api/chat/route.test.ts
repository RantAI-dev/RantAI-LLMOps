import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Engine URLs are read when the engine registry loads, so set them before the route is imported.
vi.hoisted(() => {
  process.env.VLLM_BASE_URL = "http://vllm.test:8000/v1";
  process.env.OLLAMA_BASE_URL = "http://ollama.test:11434";
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
});
vi.mock("@/lib/inference-log-store", () => ({ logInference: vi.fn(async () => {}) }));

import { POST } from "@/app/api/chat/route";
import { saveChatImage } from "@/lib/chat-image-store";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const dataUrl = (b: Buffer = JPEG) => `data:image/jpeg;base64,${b.toString("base64")}`;

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];
let ollamaTags: Array<{ name: string; capabilities?: string[] }>;
let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-route-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  process.env.RANTAI_DATA_DIR = dir;
  calls = [];
  ollamaTags = [{ name: "qwen2.5:0.5b", capabilities: ["completion"] }, { name: "llava:7b", capabilities: ["completion", "vision"] }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) return Response.json({ models: ollamaTags });
      if (url.endsWith("/chat/completions")) {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
      }
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function post(body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    }),
  );
}

describe("POST /api/chat, text only (regression)", () => {
  it("forwards plain string messages to the engine unchanged", async () => {
    const messages = [
      { role: "system", content: "be brief" },
      { role: "user", content: "halo" },
    ];
    const res = await post({ engine: "vllm", model: "base", messages });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://vllm.test:8000/v1/chat/completions");
    expect(calls[0].body).toEqual({
      model: "base",
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.7,
      max_tokens: 4096,
      frequency_penalty: 0.4,
      presence_penalty: 0.3,
      chat_template_kwargs: { thinking: false },
    });
  });

  it("an Ollama text request needs no capability lookup and is forwarded as-is", async () => {
    const messages = [{ role: "user", content: "hi" }];
    const res = await post({ model: "qwen2.5:0.5b", messages });
    expect(res.status).toBe(200);
    expect(calls[0].body.messages).toEqual(messages);
    expect(calls[0].body).not.toHaveProperty("chat_template_kwargs");
  });

  it("still requires messages", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/messages/);
  });
});

describe("POST /api/chat, images", () => {
  it("forwards an image_url array to the engine", async () => {
    const content = [
      { type: "text", text: "apa ini?" },
      { type: "image_url", image_url: { url: dataUrl() } },
    ];
    const res = await post({ engine: "vllm", model: "base", messages: [{ role: "user", content }] });
    expect(res.status).toBe(200);
    expect(calls[0].body.messages).toEqual([{ role: "user", content }]);
  });

  it("swaps a stored reference for its data URL, and only on the wire", async () => {
    const { ref } = await saveChatImage(JPEG);
    const messages = [
      { role: "user", content: [{ type: "text", text: "lihat" }, { type: "image_url", image_url: { url: ref } }] },
      { role: "assistant", content: "ya" },
    ];
    const before = JSON.stringify(messages);
    const res = await post({ engine: "vllm", model: "base", messages });
    expect(res.status).toBe(200);
    const sent = calls[0].body.messages as Array<{ content: unknown }>;
    expect(JSON.stringify(sent[0].content)).toContain(dataUrl());
    expect(JSON.stringify(sent[0].content)).not.toContain("/api/chat-images/");
    expect(sent[1].content).toBe("ya");
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("answers 400 when a referenced image is gone", async () => {
    const ref = `/api/chat-images/${"0".repeat(64)}`;
    const res = await post({
      engine: "vllm",
      model: "base",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: ref } }] }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/attach it again/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a bad image URL before contacting the engine", async () => {
    const res = await post({
      engine: "vllm",
      model: "base",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "file:///etc/passwd" } }] }],
    });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects too many images in one message", async () => {
    const part = { type: "image_url", image_url: { url: dataUrl() } };
    const res = await post({ engine: "vllm", model: "base", messages: [{ role: "user", content: [part, part, part, part, part] }] });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("answers 413 for an oversize image", async () => {
    vi.stubEnv("CHAT_MAX_IMAGE_BYTES", "8");
    const res = await post({
      engine: "vllm",
      model: "base",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl() } }] }],
    });
    vi.unstubAllEnvs();
    expect(res.status).toBe(413);
  });

  it("answers 413 on content-length before parsing the body", async () => {
    // The body is not even valid JSON: a 413 proves it was never parsed.
    const res = await post("{not json", { "content-length": String(25 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/chat, vision capability", () => {
  const withImage = [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl() } }] }];

  it("refuses images for an Ollama model known to be text-only", async () => {
    const res = await post({ model: "qwen2.5:0.5b", messages: withImage });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/does not accept images/);
    expect(calls).toHaveLength(0);
  });

  it("passes images to an Ollama model with the vision capability", async () => {
    const res = await post({ model: "llava:7b", messages: withImage });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("lets images through when vision is unknown (vLLM does not say)", async () => {
    const res = await post({ engine: "vllm", model: "ask", messages: withImage });
    expect(res.status).toBe(200);
  });

  it("text to a text-only Ollama model is fine", async () => {
    const res = await post({ model: "qwen2.5:0.5b", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
  });
});
