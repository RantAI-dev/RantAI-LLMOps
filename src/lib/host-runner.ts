/**
 * Runs host-side pipeline scripts (merge / convert / serve a fine-tune) that
 * live in the *backend's* environment, not the Next process's. Today that env is
 * WSL — the app runs on Windows while the TL backend + CUDA tooling live in a
 * WSL distro — reached via `wsl.exe`.
 *
 * SECURITY: the script command is a FIXED template that references `"$@"`; the
 * user-influenced values (job id, base model, tag) are passed as positional
 * argv elements that become `$1 $2 $3`. They never appear in the command string,
 * so they can't break out into a second shell command regardless of their
 * contents. The validation in the callers is then just defense-in-depth, not the
 * sole boundary.
 *
 * DOCKER-READY: when the backend moves to a container, only `hostArgv()` changes
 * (`wsl.exe` → `docker exec <container> …`). Set `HOST_RUNNER=docker` and
 * `DOCKER_CONTAINER=…`; every call site stays the same.
 */
import { execFile } from "node:child_process";

import { redactSecrets } from "@/lib/redact";

/** "wsl" (default), "docker", or "local". */
const HOST_RUNNER = process.env.HOST_RUNNER ?? "wsl";
const WSL_DISTRO = process.env.WSL_DISTRO ?? "Ubuntu";
const DOCKER_CONTAINER = process.env.DOCKER_CONTAINER ?? "transformerlab";

/**
 * Build argv that runs `<scriptCmd>` (a fixed template using `"$@"`) with the
 * given args bound to `$1..$N` inside the backend env. `$0` is a fixed label.
 */
function hostArgv(scriptCmd: string, args: string[]): { file: string; argv: string[] } {
  const shell = ["bash", "-lc", scriptCmd, "nqr", ...args];
  switch (HOST_RUNNER) {
    case "docker":
      return { file: "docker", argv: ["exec", DOCKER_CONTAINER, ...shell] };
    case "local":
      return { file: shell[0]!, argv: shell.slice(1) };
    case "wsl":
    default:
      return { file: "wsl.exe", argv: ["-d", WSL_DISTRO, "--", ...shell] };
  }
}

export type HostRunResult = { stdout: string; stderr: string };

/**
 * Execute a host script with argv-isolated args. Resolves with stdout/stderr on
 * success; rejects with the trailing output on non-zero exit. Any `redact`
 * values are scrubbed from the error text before it propagates.
 */
export function runHostScript(
  scriptCmd: string,
  args: string[],
  opts: { timeoutMs?: number; redact?: string[] } = {}
): Promise<HostRunResult> {
  const { file, argv } = hostArgv(scriptCmd, args);
  return new Promise((resolve, reject) => {
    execFile(
      file,
      argv,
      { timeout: opts.timeoutMs ?? 9 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-8).join("\n");
          reject(new Error(redactSecrets(tail || err.message, opts.redact ?? [])));
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}
