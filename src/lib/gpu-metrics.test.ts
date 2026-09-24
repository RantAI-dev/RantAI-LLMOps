import { afterEach, describe, expect, it, vi } from "vitest";

// The module reads env and shells out; stub the host runner so the tests
// exercise only the classification logic.
vi.mock("@/lib/host-runner", () => ({
  runHostScript: vi.fn(),
}));

import { runHostScript } from "@/lib/host-runner";
import { getGpuStatus } from "@/lib/gpu-metrics";

afterEach(() => vi.restoreAllMocks());

const CSV = "0, NVIDIA GB10, 12, 4096, 124546, 41, 11.6";

describe("getGpuStatus", () => {
  it("reports ok with the parsed GPUs", async () => {
    vi.mocked(runHostScript).mockResolvedValueOnce({ stdout: CSV, stderr: "", code: 0 });
    const status = await getGpuStatus();
    expect(status.health).toBe("ok");
    expect(status.gpus).toHaveLength(1);
    expect(status.gpus[0].name).toBe("NVIDIA GB10");
    expect(status.gpus[0].memTotalMb).toBe(124546);
  });

  // The 24 Sep incident: device nodes present, driver unreachable. Every NEW
  // GPU job failed while vLLM kept serving, and nothing surfaced the cause.
  it("calls a driver it cannot reach BLOCKED, not absent", async () => {
    vi.mocked(runHostScript).mockRejectedValueOnce(
      new Error("Failed to initialize NVML: Unknown Error"),
    );
    const status = await getGpuStatus();
    expect(status.health).toBe("blocked");
    expect(status.detail).toMatch(/cannot reach the driver/i);
  });

  it("treats a permissions failure as blocked too", async () => {
    vi.mocked(runHostScript).mockRejectedValueOnce(
      new Error("NVIDIA-SMI couldn't communicate with the NVIDIA driver"),
    );
    expect((await getGpuStatus()).health).toBe("blocked");
  });

  it("calls a machine with no nvidia-smi 'none', which is not an outage", async () => {
    vi.mocked(runHostScript).mockRejectedValueOnce(new Error("nvidia-smi: command not found"));
    const status = await getGpuStatus();
    expect(status.health).toBe("none");
  });

  it("reports 'none' when nvidia-smi runs but lists nothing", async () => {
    vi.mocked(runHostScript).mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 });
    expect((await getGpuStatus()).health).toBe("none");
  });

  // The sidecar answers 200 even when nvidia-smi failed, saying so via
  // `available: false`. Trusting the HTTP status alone would read that as
  // healthy-but-empty, which is the confusion this whole module removes.
  it("treats the sidecar's own available:false as blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          available: false,
          csv: "",
          error: "Failed to initialize NVML: Unknown Error",
        }),
      })),
    );
    vi.stubEnv("GPU_STATS_URL", "http://backend:8341");
    // The module reads GPU_STATS_URL at import time, so re-import it fresh.
    vi.resetModules();
    const { getGpuStatus: fresh } = await import("@/lib/gpu-metrics");
    const status = await fresh();
    expect(status.health).toBe("blocked");
    expect(status.detail).toMatch(/cannot reach the driver/i);
  });

  it("defaults an unrecognised failure to blocked rather than silently empty", async () => {
    vi.mocked(runHostScript).mockRejectedValueOnce(new Error("something entirely new"));
    const status = await getGpuStatus();
    expect(status.health).toBe("blocked");
    expect(status.detail).toMatch(/something entirely new/);
  });
});
