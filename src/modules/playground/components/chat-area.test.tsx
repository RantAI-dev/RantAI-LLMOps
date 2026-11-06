import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/modules/playground/types";

// The pickers fetch catalogs and use the Next router; they are not under test here.
vi.mock("@/modules/playground/components/model-picker", () => ({
  ModelPicker: ({ onChange }: { onChange: (m: string) => void }) => (
    <button type="button" onClick={() => onChange("qwen2.5:0.5b")}>
      pick-text-model
    </button>
  ),
}));
vi.mock("@/modules/playground/components/engine-picker", () => ({ EnginePicker: () => null }));
vi.mock("@/modules/playground/components/vllm-model-picker", () => ({ VllmModelPicker: () => null }));
vi.mock("@/modules/serve/hooks/use-engines", () => ({
  useEngines: () => ({
    engines: [
      {
        id: "ollama",
        label: "Ollama",
        models: [
          { id: "qwen2.5:0.5b", name: "qwen2.5:0.5b", isGguf: true, vision: false },
          { id: "llava:7b", name: "llava:7b", isGguf: true, vision: true },
        ],
      },
    ],
    loading: false,
    reload: () => {},
  }),
}));
// jsdom has no canvas: the shrink step is stubbed, the rest of image-prep is real.
vi.mock("@/modules/playground/lib/image-prep", async (orig) => ({
  ...(await orig<typeof import("@/modules/playground/lib/image-prep")>()),
  downscaleToJpegDataUrl: vi.fn(async () => "data:image/jpeg;base64,/9j/AAAA"),
  uploadChatImage: vi.fn(async () => `/api/chat-images/${"c".repeat(64)}`),
}));

import { ChatArea } from "@/modules/playground/components/chat-area";
import { MessageContentView } from "@/modules/playground/components/message-content-view";

const REF = `/api/chat-images/${"c".repeat(64)}`;
let chatBodies: Array<{ messages: ChatMessage[] }>;

beforeEach(() => {
  // jsdom has no Element.scrollTo (the area pins itself to the newest message).
  Element.prototype.scrollTo = vi.fn();
  chatBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/chat") {
        chatBodies.push(JSON.parse(String(init?.body)));
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
      }
      return Response.json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup(messages: ChatMessage[] = []) {
  let current = messages;
  const setMessages = vi.fn((updater: (p: ChatMessage[]) => ChatMessage[]) => {
    current = updater(current);
  });
  const view = render(<ChatArea messages={messages} setMessages={setMessages} />);
  return { ...view, setMessages, latest: () => current };
}

const png = () => new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
const fileInput = () => screen.getByTestId("image-file-input") as HTMLInputElement;

describe("ChatArea image input", () => {
  it("shows a thumbnail with a remove button after attaching", async () => {
    setup();
    await userEvent.upload(fileInput(), png());
    const list = await screen.findByRole("list", { name: "Attached images" });
    const thumb = within(list).getByAltText("Attached image") as HTMLImageElement;
    expect(thumb.src).toMatch(/^data:image\/jpeg/); // local preview, not blob:
    await userEvent.click(within(list).getByRole("button", { name: "Remove image" }));
    expect(screen.queryByRole("list", { name: "Attached images" })).toBeNull();
  });

  it("enables Send with an image alone, and sends stored references, not pixels", async () => {
    const { setMessages } = setup();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await userEvent.upload(fileInput(), png());
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0].messages).toEqual([{ role: "user", content: [{ type: "image_url", image_url: { url: REF } }] }]);
    expect(JSON.stringify(chatBodies[0])).not.toContain("base64");
    // What goes into the (persisted) session is the same reference-only message.
    const saved = setMessages.mock.calls.at(0)![0]([]);
    expect(JSON.stringify(saved)).not.toContain("base64");
    // The tray is empty again.
    expect(screen.queryByRole("list", { name: "Attached images" })).toBeNull();
  });

  it("sends text plus image as parts, and text alone stays a string", async () => {
    setup();
    await userEvent.type(screen.getByPlaceholderText("Ask anything…"), "apa ini?");
    await userEvent.upload(fileInput(), png());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0].messages[0].content).toEqual([
      { type: "text", text: "apa ini?" },
      { type: "image_url", image_url: { url: REF } },
    ]);
  });

  it("text-only messages are unchanged (plain string)", async () => {
    setup();
    await userEvent.type(screen.getByPlaceholderText("Ask anything…"), "halo");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0].messages).toEqual([{ role: "user", content: "halo" }]);
  });

  it("attaches from a paste of an image, and leaves a text paste alone", async () => {
    setup();
    const box = screen.getByPlaceholderText("Ask anything…");
    fireEvent.paste(box, { clipboardData: { files: [png()], getData: () => "" } });
    await screen.findByRole("list", { name: "Attached images" });
    expect(screen.getAllByAltText("Attached image")).toHaveLength(1);
    fireEvent.paste(box, { clipboardData: { files: [], getData: () => "plain" } });
    expect(screen.getAllByAltText("Attached image")).toHaveLength(1);
  });

  it("attaches from a drop", async () => {
    setup();
    const zone = screen.getByPlaceholderText("Ask anything…").closest("div[class*='rounded-2xl']")!;
    fireEvent.drop(zone, { dataTransfer: { files: [png()], types: ["Files"] } });
    await screen.findByRole("list", { name: "Attached images" });
  });

  it("refuses a fifth image with a clear message", async () => {
    setup();
    await userEvent.upload(fileInput(), [png(), png(), png(), png()]);
    await waitFor(() => expect(screen.getAllByAltText("Attached image")).toHaveLength(4));
    await userEvent.upload(fileInput(), png());
    expect(await screen.findByText(/at most 4 images per message/)).toBeInTheDocument();
    expect(screen.getAllByAltText("Attached image")).toHaveLength(4);
  });

  it("refuses a file that is not an image", async () => {
    setup();
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText(/a\.pdf is not a PNG/)).toBeInTheDocument();
  });

  it("disables attaching, with the reason, for a model known to be text-only", async () => {
    setup();
    const clip = screen.getByRole("button", { name: "Attach images" });
    expect(clip).toBeEnabled();
    await userEvent.click(screen.getByText("pick-text-model"));
    await waitFor(() => expect(clip).toBeDisabled());
    expect(clip.closest("span")).toHaveAttribute("title", "This model does not accept images.");
  });
});

describe("MessageContentView", () => {
  it("renders text with line breaks and images from the stored route", () => {
    const { container } = render(
      <MessageContentView
        content={[
          { type: "text", text: "baris 1\nbaris 2" },
          { type: "image_url", image_url: { url: REF } },
        ]}
      />,
    );
    expect(container.querySelector(".whitespace-pre-wrap")?.textContent).toBe("baris 1\nbaris 2");
    expect((screen.getByAltText("Attached image") as HTMLImageElement).getAttribute("src")).toBe(REF);
  });

  it("enlarges an image on click", async () => {
    render(<MessageContentView content={[{ type: "image_url", image_url: { url: REF } }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Enlarge image" }));
    expect(await screen.findByAltText("Attached image, enlarged")).toBeInTheDocument();
  });

  it("renders a plain string, and the placeholder for an empty one", () => {
    const { rerender } = render(<MessageContentView content="halo" />);
    expect(screen.getByText("halo")).toBeInTheDocument();
    rerender(<MessageContentView content="" placeholder="…" />);
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("a chat with an image message does not crash the area", () => {
    setup([
      { role: "user", content: [{ type: "text", text: "lihat" }, { type: "image_url", image_url: { url: REF } }] },
      { role: "assistant", content: "sebuah kotak" },
    ]);
    expect(screen.getByText("lihat")).toBeInTheDocument();
    expect(screen.getByText("sebuah kotak")).toBeInTheDocument();
    expect(screen.getByAltText("Attached image")).toBeInTheDocument();
  });
});
