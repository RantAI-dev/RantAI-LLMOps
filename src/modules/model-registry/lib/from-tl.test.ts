import { describe, expect, it } from "vitest";

import { paramSizeFromName } from "@/modules/model-registry/lib/from-tl";

describe("paramSizeFromName", () => {
  it("reads the parameter size from clean HF model names", () => {
    expect(paramSizeFromName("hf.co/prithivMLmods/Qwen2.5-Coder-1.5B-GGUF:Q4_K_M")).toBe("1.5B");
    expect(paramSizeFromName("hf.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M")).toBe("3B");
    expect(paramSizeFromName("hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M")).toBe("1B");
    expect(paramSizeFromName("qwen2.5:0.5b")).toBe("0.5B");
  });

  it("returns '—' rather than guessing from an ambiguous fine-tune slug", () => {
    // "qwen3-1-7b" could be 1.7B, "llama-3-8b" is 8B not 3.8B — unrecoverable.
    expect(paramSizeFromName("nqr-qwen3-1-7b-claude-fable-bf122f19:latest")).toBe("—");
    expect(paramSizeFromName("nqr-llama-3-8b-sql-abcd1234:latest")).toBe("—");
    expect(paramSizeFromName("nqr-real-adaptor-b315392e:latest")).toBe("—");
  });

  it("returns '—' when no size token is present", () => {
    expect(paramSizeFromName("some-model-name")).toBe("—");
  });
});
