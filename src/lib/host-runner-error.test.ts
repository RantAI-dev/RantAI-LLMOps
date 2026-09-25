import { describe, expect, it } from "vitest";

import { extractError } from "@/lib/host-runner";

/**
 * Reading the cause out of a failed host script.
 *
 * This hid a real failure on 25 Sep: a 4B adapter merge died of "CUDA error:
 * out of memory", and the app reported "Traceback (most recent call last):" —
 * the header of the traceback rather than the line under it that names the
 * cause. The failure looked mysterious for as long as that message was all
 * anyone had.
 */
describe("extractError", () => {
  it("returns the cause under a traceback, not the traceback header", () => {
    const out = [
      "Loading checkpoint shards: 100%|██████████| 2/2",
      "Traceback (most recent call last):",
      '  File "<stdin>", line 6, in <module>',
      "    adapters_weights = load_peft_weights(model_id, device=torch_device)",
      "torch.AcceleratorError: CUDA error: out of memory",
    ].join("\n");

    expect(extractError(out)).toBe("torch.AcceleratorError: CUDA error: out of memory");
  });

  it("takes the last cause when frames nest", () => {
    const out = [
      "huggingface_hub.errors.RepositoryNotFoundError: 404 Client Error.",
      "The above exception was the direct cause of the following exception:",
      "Traceback (most recent call last):",
      "OSError: model-xyz is not a local folder and is not a valid model identifier",
    ].join("\n");

    expect(extractError(out)).toBe(
      "OSError: model-xyz is not a local folder and is not a valid model identifier"
    );
  });

  it("still handles a plain Error: line with no traceback", () => {
    expect(extractError("pulling…\nError: manifest unknown")).toBe("Error: manifest unknown");
  });

  it("falls back to the tail when nothing is marked as an error", () => {
    const out = ["step one", "step two", "it just stopped"].join("\n");
    expect(extractError(out)).toContain("it just stopped");
  });

  it("prefers real output over the Jinja the GGUF converter echoes", () => {
    // The converter dumps the chat template to stdout; those lines are skipped
    // so the tail fallback reports the script's own words instead.
    const out = ["conversion failed on shard 2", "{%- if tools %}", "{{- bos_token }}"].join("\n");
    expect(extractError(out)).toBe("conversion failed on shard 2");
  });

  it("never returns an empty string", () => {
    expect(extractError("").length).toBeGreaterThan(0);
  });
});
