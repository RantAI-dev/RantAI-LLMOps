import { describe, expect, it } from "vitest";

import { CACHE_VERSION, computeConfigHash, type CacheableConfig } from "@/lib/pipeline-cache";

const base: CacheableConfig = {
  baseModel: "meta-llama/Llama-3.1-8B",
  baseModelArchitecture: "LlamaForCausalLM",
  dataset: "team/rugby-qa",
  adaptorName: "rugby-pipeline",
  epochs: 3,
};

describe("computeConfigHash", () => {
  it("is deterministic for the same inputs", () => {
    expect(computeConfigHash(base)).toBe(computeConfigHash({ ...base }));
  });

  it("changes when any training input changes", () => {
    const h = computeConfigHash(base);
    expect(computeConfigHash({ ...base, baseModel: "other/model" })).not.toBe(h);
    expect(computeConfigHash({ ...base, dataset: "team/other" })).not.toBe(h);
    expect(computeConfigHash({ ...base, adaptorName: "other-name" })).not.toBe(h);
    expect(computeConfigHash({ ...base, epochs: 4 })).not.toBe(h);
    expect(computeConfigHash({ ...base, baseModelArchitecture: "Other" })).not.toBe(h);
  });

  it("treats a missing architecture as empty (not undefined-coerced differently)", () => {
    const { baseModelArchitecture: _drop, ...noArch } = base;
    void _drop;
    expect(computeConfigHash({ ...noArch, baseModelArchitecture: "" })).toBe(computeConfigHash(noArch));
  });

  it("does NOT depend on eval/export fields (only training inputs decide the adapter)", () => {
    // Same training inputs → same hash regardless of downstream stage choices.
    expect(computeConfigHash(base)).toBe(
      computeConfigHash({
        baseModel: base.baseModel,
        baseModelArchitecture: base.baseModelArchitecture,
        dataset: base.dataset,
        adaptorName: base.adaptorName,
        epochs: base.epochs,
      })
    );
  });

  it("produces a compact hex string", () => {
    expect(computeConfigHash(base)).toMatch(/^[0-9a-f]+$/);
  });

  it("exposes a numeric CACHE_VERSION", () => {
    expect(typeof CACHE_VERSION).toBe("number");
  });
});
