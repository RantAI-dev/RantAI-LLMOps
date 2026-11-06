import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VllmDeploy } from "@/modules/serve/components/vllm-deploy";

let posts: Array<Record<string, unknown>>;

beforeEach(() => {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/models/catalog") {
        return Response.json({
          downloaded: [
            { id: "/models/m1-custom", vision: true },
            { id: "/models/text-only", vision: false },
          ],
        });
      }
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({ deployment: null });
      }
      return Response.json({ deployment: null, status: "NONE", servedUrl: null });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const baseInput = () => screen.findByPlaceholderText(/HF id or local path/);
const limitField = () => screen.queryByText("Images per request");

describe("VllmDeploy image limits", () => {
  it("shows the two fields only for a vision base", async () => {
    render(<VllmDeploy engine="vllm" />);
    const input = await baseInput();
    expect(limitField()).toBeNull();

    await userEvent.type(input, "aisingapore/Llama-SEA-LION-v3.5-8B-R");
    expect(limitField()).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "aisingapore/Qwen-SEA-LION-v4-8B-VL");
    expect(limitField()).toBeInTheDocument();
    expect(screen.getByText("Max pixels per image")).toBeInTheDocument();
  });

  it("recognises a vision base from the catalog even when its path says nothing", async () => {
    render(<VllmDeploy engine="sglang" />);
    await userEvent.type(await baseInput(), "/models/m1-custom");
    await waitFor(() => expect(limitField()).toBeInTheDocument());
  });

  it("sends the limits only when filled in, and as numbers", async () => {
    render(<VllmDeploy engine="vllm" />);
    await userEvent.type(await baseInput(), "aisingapore/Gemma-SEA-LION-v4-4B-VL");
    await userEvent.click(screen.getByRole("button", { name: "Deploy vLLM" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("limitMmImages");
    expect(posts[0]).not.toHaveProperty("maxImagePixels");

    const [images, pixels] = screen.getAllByPlaceholderText(/^e\.g\./);
    await userEvent.type(images, "4");
    await userEvent.type(pixels, "1048576");
    await userEvent.click(screen.getByRole("button", { name: "Deploy vLLM" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ limitMmImages: 4, maxImagePixels: 1048576, baseVision: true });
  });

  it("never sends limits for a text base", async () => {
    render(<VllmDeploy engine="vllm" />);
    await userEvent.type(await baseInput(), "/models/text-only");
    await userEvent.click(screen.getByRole("button", { name: "Deploy vLLM" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("limitMmImages");
    expect(posts[0]).not.toHaveProperty("baseVision");
  });
});
