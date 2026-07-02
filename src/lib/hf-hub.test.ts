import { describe, expect, it } from "vitest";

import { quantFromFile } from "@/lib/hf-hub";

describe("quantFromFile", () => {
  it("extracts common quant tags from GGUF filenames", () => {
    expect(quantFromFile("Llama-3.2-1B-Instruct-Q4_K_M.gguf")).toBe("Q4_K_M");
    expect(quantFromFile("Model-Q4_0.gguf")).toBe("Q4_0");
    expect(quantFromFile("Model-Q8_0.gguf")).toBe("Q8_0");
    expect(quantFromFile("Model-Q5_K_S.gguf")).toBe("Q5_K_S");
  });

  it("handles IQ and float variants", () => {
    expect(quantFromFile("Llama-3.2-1B-Instruct-IQ3_M.gguf")).toBe("IQ3_M");
    expect(quantFromFile("Model-IQ4_XS.gguf")).toBe("IQ4_XS");
    expect(quantFromFile("Model-f16.gguf")).toBe("F16");
    expect(quantFromFile("Model-BF16.gguf")).toBe("BF16");
  });

  it("is case-insensitive on the .gguf extension and uppercases the quant", () => {
    expect(quantFromFile("Model-q4_k_m.GGUF")).toBe("Q4_K_M");
  });

  it("falls back to the last segment when no quant token is present", () => {
    expect(quantFromFile("some-model-name.gguf")).toBe("NAME");
  });
});
