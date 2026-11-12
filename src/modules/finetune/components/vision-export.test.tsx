import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exportMock } = vi.hoisted(() => ({ exportMock: vi.fn() }));
vi.mock("@/lib/export-progress", () => ({ exportModelWithProgress: exportMock }));

import { VisionExport } from "@/modules/finetune/components/vision-export";

// Braces matter: a function returned from beforeEach is run by Vitest as a teardown hook.
beforeEach(() => {
  exportMock.mockReset();
});

describe("VisionExport", () => {
  it("exports with the chosen GGUF type and shows the two files and the llama-server command", async () => {
    const vl = { gguf: "/m/x.f16.gguf", mmproj: "/m/mmproj-x.f16.gguf", command: "llama-server -m /m/x.f16.gguf --mmproj /m/mmproj-x.f16.gguf" };
    exportMock.mockImplementation(async (_id: string, onStage: (m: string, p: number | null) => void) => {
      onStage("Merging adapter into base model…", null);
      return { tag: "", vl };
    });
    render(<VisionExport jobId="job-1" />);
    await userEvent.selectOptions(screen.getByLabelText("GGUF for llama.cpp"), "f16");
    await userEvent.click(screen.getByRole("button", { name: /Export GGUF \+ projector/ }));
    await waitFor(() => expect(screen.getByText(vl.command)).toBeInTheDocument());
    expect(exportMock).toHaveBeenCalledWith("job-1", expect.any(Function), "f16");
    expect(screen.getByText(vl.gguf)).toBeInTheDocument();
    expect(screen.getByText(vl.mmproj)).toBeInTheDocument();
    expect(screen.getByText(/Ollama cannot load a vision projector/)).toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    exportMock.mockRejectedValue(new Error("ADAPTER_NOT_FOUND for job job-1"));
    render(<VisionExport jobId="job-1" />);
    await userEvent.click(screen.getByRole("button", { name: /Export GGUF \+ projector/ }));
    await waitFor(() => expect(screen.getByText(/Export failed: ADAPTER_NOT_FOUND/)).toBeInTheDocument());
  });
});
