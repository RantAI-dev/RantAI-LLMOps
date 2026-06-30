import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock sonner so the toast call is observable without a DOM toaster.
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { runOptimistic } from "@/lib/optimistic";

const okResponse = () => ({ ok: true }) as Response;
const failResponse = () =>
  ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }) as unknown as Response;

describe("runOptimistic", () => {
  beforeEach(() => toastError.mockClear());

  it("applies the change and returns true on success (no toast)", async () => {
    const apply = vi.fn();
    const ok = await runOptimistic({ apply, request: async () => okResponse() });
    expect(apply).toHaveBeenCalledOnce();
    expect(ok).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("rolls back and toasts the server message on a non-ok response", async () => {
    const rollback = vi.fn();
    const ok = await runOptimistic({
      apply: vi.fn(),
      request: async () => failResponse(),
      rollback,
    });
    expect(ok).toBe(false);
    expect(rollback).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith("boom");
  });

  it("rolls back and toasts the custom message when the request throws", async () => {
    const rollback = vi.fn();
    const ok = await runOptimistic({
      request: async () => {
        throw new Error("network down");
      },
      rollback,
      errorMessage: "Gagal menyimpan",
    });
    expect(ok).toBe(false);
    expect(rollback).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith("Gagal menyimpan");
  });
});
