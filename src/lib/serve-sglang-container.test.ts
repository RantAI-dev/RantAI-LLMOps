import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { SGLANG_ENTRYPOINT, sglangEnv } from "@/lib/serve-sglang-container";
import { ENTRYPOINT_SCRIPT } from "@/lib/serve-vllm-container";

describe("sglangEnv", () => {
  it("passes the base, defaults and adapters to the entrypoint", () => {
    const env = sglangEnv({
      baseModel: "aisingapore/Qwen-SEA-LION-v4-8B-VL",
      adapters: [
        { name: "ask", path: "/root/.transformerlab/a" },
        { name: "learn", path: "/root/.transformerlab/b" },
      ],
    });
    expect(env).toContain("SGLANG_MODEL=aisingapore/Qwen-SEA-LION-v4-8B-VL");
    expect(env).toContain("SGLANG_SERVED_NAME=base");
    expect(env).toContain("SGLANG_MEM_FRACTION=0.38");
    expect(env).toContain("SGLANG_CONTEXT_LENGTH=8192");
    expect(env).toContain("SGLANG_LORA_MODULES=ask=/root/.transformerlab/a learn=/root/.transformerlab/b");
  });

  it("refuses adapter names and paths the space-separated list cannot carry", () => {
    expect(() => sglangEnv({ baseModel: "m", adapters: [{ name: "a:b", path: "/x" }] })).toThrow(/Invalid adapter name/);
    expect(() => sglangEnv({ baseModel: "m", adapters: [{ name: "../x", path: "/x" }] })).toThrow(/Invalid adapter name/);
    expect(() => sglangEnv({ baseModel: "m", adapters: [{ name: "a", path: "/my dir" }] })).toThrow(/without spaces/);
  });
});

describe("SGLANG_ENTRYPOINT", () => {
  it("lists Unsloth's regex target_modules before SGLang reads the adapters", () => {
    expect(SGLANG_ENTRYPOINT).toContain("isinstance(tm, str) and tm not in ('all', 'all-linear')");
    expect(SGLANG_ENTRYPOINT.indexOf("PY\n")).toBeLessThan(SGLANG_ENTRYPOINT.indexOf("sglang.launch_server"));
  });

  it("points --lora-paths at the prepared copies, not the shared adapters", () => {
    expect(SGLANG_ENTRYPOINT).toContain('"${spec%%=*}=/tmp/loras/${spec%%=*}"');
  });
});

// Run the launch part of an entrypoint in bash with `exec <server>` swapped for a
// printer, to check the argv the server really gets (a bare newline between
// continued flag lines once made them a separate command).
function launchArgs(script: string, from: string, server: RegExp, env: Record<string, string>): string[] {
  const tail = script.slice(script.indexOf(from)).replace(server, "printf '%s\n'");
  const r = spawnSync("bash", ["-c", tail], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim().split("\n");
}

describe("entrypoint argv", () => {
  it("SGLang gets every flag and the prepared adapter paths", () => {
    const env = Object.fromEntries(
      sglangEnv({ baseModel: "org/m", adapters: [{ name: "ask", path: "/a" }, { name: "learn", path: "/b" }] }).map((e) => {
        const i = e.indexOf("=");
        return [e.slice(0, i), e.slice(i + 1)];
      })
    );
    const args = launchArgs(SGLANG_ENTRYPOINT, "set -- --model-path", /exec python3 -m sglang\.launch_server/, env);
    expect(args.slice(0, 4)).toEqual(["--model-path", "org/m", "--served-model-name", "base"]);
    expect(args).toEqual(expect.arrayContaining(["--mem-fraction-static", "0.38", "--context-length", "8192", "--enable-metrics"]));
    expect(args.slice(-4)).toEqual(["--enable-lora", "--lora-paths", "ask=/tmp/loras/ask", "learn=/tmp/loras/learn"]);
  });

  it("vLLM gets every flag", () => {
    const args = launchArgs(ENTRYPOINT_SCRIPT, "set -- ", /exec vllm serve/, {
      VLLM_MODEL: "org/m",
      VLLM_SERVED_NAME: "base",
      VLLM_GPU_UTIL: "0.3",
      VLLM_MAX_MODEL_LEN: "8192",
      VLLM_LORA_MODULES: "ask=/a",
    });
    expect(args.slice(0, 3)).toEqual(["org/m", "--served-model-name", "base"]);
    expect(args).toEqual(expect.arrayContaining(["--gpu-memory-utilization", "0.3", "--enforce-eager", "--lora-modules", "ask=/a"]));
  });
});
