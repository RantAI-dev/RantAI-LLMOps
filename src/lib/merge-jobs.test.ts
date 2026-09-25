import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMerges, awaitMerge, getMerge, listMerges, startMerge } from "@/lib/merge-jobs";

/**
 * Merges tracked as jobs.
 *
 * The behaviour that matters is what used to go wrong: a merge held inside a
 * request that had a deadline, and two submits for the same fine-tune both
 * writing 8 GB into the same directory.
 */
describe("startMerge", () => {
  beforeEach(() => __resetMerges());

  it("returns immediately while the merge is still running", async () => {
    let release: (v: { modelPath: string; label: string }) => void = () => {};
    const run = vi.fn(
      () => new Promise<{ modelPath: string; label: string }>((res) => (release = res))
    );

    const handle = startMerge("job-1", "my-tune", run);
    // The whole point: we have a handle before the work is anywhere near done.
    expect(handle.status).toBe("RUNNING");
    expect(handle.modelPath).toBeUndefined();

    release({ modelPath: "/merged/my-tune", label: "my-tune" });
    const done = await awaitMerge("job-1");
    expect(done?.status).toBe("COMPLETE");
    expect(done?.modelPath).toBe("/merged/my-tune");
  });

  it("two submits for the same fine-tune share ONE merge", async () => {
    // Without this they race on the same output dir, each writing 8 GB over the
    // other's half-written files.
    const run = vi.fn(async () => ({ modelPath: "/merged/x", label: "x" }));

    startMerge("job-2", "x", run);
    startMerge("job-2", "x", run);
    startMerge("job-2", "x", run);
    await awaitMerge("job-2");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not re-run a merge that already completed", async () => {
    // Its output is still on disk — that is exactly why a retry used to look
    // like it had fixed something.
    const run = vi.fn(async () => ({ modelPath: "/merged/y", label: "y" }));
    startMerge("job-3", "y", run);
    await awaitMerge("job-3");

    const again = startMerge("job-3", "y", run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(again.status).toBe("COMPLETE");
    expect(again.modelPath).toBe("/merged/y");
  });

  it("records the reason a merge failed instead of throwing", async () => {
    const run = vi.fn(async () => {
      throw new Error("ADAPTER_NOT_FOUND for job job-4");
    });

    startMerge("job-4", "z", run);
    const done = await awaitMerge("job-4");

    expect(done?.status).toBe("FAILED");
    expect(done?.error).toContain("ADAPTER_NOT_FOUND");
    expect(done?.modelPath).toBeUndefined();
  });

  it("a FAILED merge can be retried, unlike a COMPLETE one", async () => {
    const run = vi
      .fn<() => Promise<{ modelPath: string; label: string }>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce({ modelPath: "/merged/w", label: "w" });

    startMerge("job-5", "w", run);
    expect((await awaitMerge("job-5"))?.status).toBe("FAILED");

    startMerge("job-5", "w", run);
    const second = await awaitMerge("job-5");
    expect(run).toHaveBeenCalledTimes(2);
    expect(second?.status).toBe("COMPLETE");
  });

  it("exposes merges for the UI to poll, newest first", async () => {
    const run = async () => ({ modelPath: "/m", label: "l" });
    startMerge("job-6", "a", run);
    startMerge("job-7", "b", run);
    await Promise.all([awaitMerge("job-6"), awaitMerge("job-7")]);

    const all = listMerges();
    expect(all).toHaveLength(2);
    expect(all[0].startedAt).toBeGreaterThanOrEqual(all[1].startedAt);
    // Serialisable: no promise leaks to the client.
    expect(JSON.stringify(all)).toContain("job-6");
  });

  it("reports nothing for a fine-tune this process never merged", async () => {
    expect(getMerge("never-seen")).toBeUndefined();
    await expect(awaitMerge("never-seen")).resolves.toBeUndefined();
  });
});
