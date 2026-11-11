import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SGLANG_ENTRYPOINT, SGLANG_LORA_HELPER, VISION_LORA_PY, sglangEnv } from "@/lib/serve-sglang-container";
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
function launchArgs(script: string, from: string, server: RegExp, env: Record<string, string>, shell = "bash"): string[] {
  const tail = script.slice(script.indexOf(from)).replace(server, "printf '%s\n'");
  const r = spawnSync(shell, ["-c", tail], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
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
    // Gemma-3 VL is text-only in SGLang unless this flag is given (found on the GB10, 11 Nov 2026).
    expect(args).toContain("--enable-multimodal");
    expect(args.slice(-6)).toEqual(["--enable-lora", "--max-lora-rank", "16", "--lora-paths", "ask=/tmp/loras/ask", "learn=/tmp/loras/learn"]);
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

  const envOf = (list: string[]) =>
    Object.fromEntries(list.map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]));

  it("SGLang adds the multimodal flags as intact JSON, and only when set", () => {
    const base = { baseModel: "aisingapore/Qwen-SEA-LION-v4-8B-VL" };
    const plain = launchArgs(SGLANG_ENTRYPOINT, "set -- --model-path", /exec python3 -m sglang\.launch_server/, envOf(sglangEnv(base)));
    expect(plain).not.toContain("--limit-mm-data-per-request");
    expect(plain).not.toContain("--mm-process-config");

    const env = envOf(sglangEnv({ ...base, limitMmImages: 4, maxImagePixels: 1048576 }));
    const args = launchArgs(SGLANG_ENTRYPOINT, "set -- --model-path", /exec python3 -m sglang\.launch_server/, env);
    expect(JSON.parse(args[args.indexOf("--limit-mm-data-per-request") + 1])).toEqual({ image: 4 });
    expect(JSON.parse(args[args.indexOf("--mm-process-config") + 1])).toEqual({ image: { max_pixels: 1048576 } });
  });

  it("vLLM adds the multimodal flags as intact JSON under /bin/sh, and only when set", () => {
    const sh = "sh";
    const run = (env: Record<string, string>) =>
      launchArgs(ENTRYPOINT_SCRIPT, "set -- ", /exec vllm serve/, { VLLM_MODEL: "org/m", VLLM_SERVED_NAME: "base", VLLM_GPU_UTIL: "0.3", VLLM_MAX_MODEL_LEN: "8192", ...env }, sh);
    const plain = run({});
    expect(plain).not.toContain("--limit-mm-per-prompt");
    expect(plain).not.toContain("--mm-processor-kwargs");

    const args = run({ VLLM_LIMIT_MM_IMAGES: "4", VLLM_MAX_IMAGE_PIXELS: "1048576", VLLM_LORA_MODULES: "ask=/a" });
    expect(args[args.indexOf("--limit-mm-per-prompt") + 1]).toBe('{"image":4}');
    expect(args[args.indexOf("--mm-processor-kwargs") + 1]).toBe('{"max_pixels":1048576}');
    expect(args.slice(-2)).toEqual(["--lora-modules", "ask=/a"]);
  });
});

// SGLang applies LoRA to the language model only. An adapter that also changes the vision tower must be
// refused with a reason, in the helper (hot attach) and in the entrypoint (start-up).
const hasPython = process.platform !== "win32" && spawnSync("python3", ["--version"]).status === 0;
const LM_KEYS = [
  "base_model.model.model.language_model.layers.0.self_attn.q_proj.lora_A.weight",
  "base_model.model.model.language_model.layers.0.self_attn.q_proj.lora_B.weight",
  "base_model.model.model.language_model.layers.0.mlp.down_proj.lora_A.weight",
];

function fakeAdapter(keys: string[], cfg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "lora-"));
  const header = Buffer.from(
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, { dtype: "F32", shape: [1], data_offsets: [0, 4] }])))
  );
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(header.length));
  writeFileSync(join(dir, "adapter_model.safetensors"), Buffer.concat([len, header, Buffer.alloc(4)]));
  writeFileSync(join(dir, "adapter_config.json"), JSON.stringify(cfg));
  return dir;
}

function pythonRun(code: string): string {
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

describe.skipIf(!hasPython)("SGLang adapter preparation refuses vision-tower LoRA", () => {
  const helper = SGLANG_LORA_HELPER.split("class H(")[0];
  const prepare = (dir: string, name: string) =>
    pythonRun(`${helper}\ntry:\n    print("OK", prepare(${JSON.stringify(name)}, ${JSON.stringify(dir)}))\nexcept Exception as e:\n    print("ERR", e)\n`);

  it("lists the language modules of a language-only adapter with a regex target_modules", () => {
    const dir = fakeAdapter(LM_KEYS, { r: 16, target_modules: "(?:.*language.*)" });
    const name = `vlm-test-${process.pid}`;
    try {
      expect(prepare(dir, name)).toBe(`OK /tmp/loras-hot/${name}`);
      const cfg = pythonRun(`import json; print(json.load(open("/tmp/loras-hot/${name}/adapter_config.json"))["target_modules"])`);
      expect(cfg).toBe("['down_proj', 'q_proj']");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(`/tmp/loras-hot/${name}`, { recursive: true, force: true });
    }
  });

  it.each([
    ["Qwen-VL tower", "base_model.model.model.visual.blocks.0.attn.qkv.lora_A.weight"],
    ["Gemma tower", "base_model.model.model.vision_tower.vision_model.encoder.layers.0.self_attn.q_proj.lora_A.weight"],
    ["Gemma projector", "base_model.model.model.multi_modal_projector.mm_input_projection.lora_A.weight"],
  ])("refuses an adapter that also changes the %s, whatever its target_modules", (_label, key) => {
    for (const tm of ["(?:.*)", "all-linear", ["q_proj"]]) {
      const dir = fakeAdapter([...LM_KEYS, key], { r: 16, target_modules: tm });
      try {
        const out = prepare(dir, "vis");
        expect(out).toMatch(/^ERR adapter vis changes the vision tower or projector \(1 tensors, e\.g\. /);
        expect(out).toContain("--enable-tower-connector-lora");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("uses the same check in the entrypoint script", () => {
    expect(SGLANG_ENTRYPOINT).toContain("refuse_vision(name, keys)");
    expect(SGLANG_ENTRYPOINT).toContain(VISION_LORA_PY.split("\n")[0]);
  });
});
