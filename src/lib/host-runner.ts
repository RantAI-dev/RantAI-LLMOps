/**
 * Runs host-side pipeline scripts (merge / convert / serve a fine-tune) that
 * live in the *backend's* environment, not the Next process's. Today that env is
 * WSL — the app runs on Windows while the TL backend + CUDA tooling live in a
 * WSL distro — reached via `wsl.exe`.
 *
 * SECURITY: user-influenced values (job id, base model, tag) are substituted into
 * the command as SINGLE-QUOTED strings, with any embedded quote escaped
 * (`'` -> `'\''`). Combined with the callers' `assert*` validation (which rejects
 * shell metacharacters up front), a value can't break out of its quotes into a
 * second command. We interpolate rather than pass positional argv because
 * `wsl.exe … bash -lc '<cmd>' name a b c` and `docker exec … bash -lc '<cmd>' name
 * a b c` DROP the trailing positional args in this environment (verified: `$#`
 * comes back 0), so `"$@"` would always be empty.
 *
 * DOCKER-READY: only `hostArgv()` changes (`wsl.exe` → `docker exec <container>`).
 * Set `HOST_RUNNER=docker` and `DOCKER_CONTAINER=…`; every call site stays the same.
 */
import { execFile } from "node:child_process";

import { redactSecrets } from "@/lib/redact";

/** "wsl" (default), "docker", or "local". */
const HOST_RUNNER = process.env.HOST_RUNNER ?? "wsl";
const WSL_DISTRO = process.env.WSL_DISTRO ?? "Ubuntu";
const DOCKER_CONTAINER = process.env.DOCKER_CONTAINER ?? "transformerlab";

/** Single-quote a value for safe shell interpolation (escapes embedded quotes). */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Wrap a fully-built command string to run inside the backend env. */
function hostArgv(fullCmd: string): { file: string; argv: string[] } {
  const shell = ["bash", "-lc", fullCmd];
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
 * Execute a host script. `scriptCmd` is a fixed template; its `"$@"` placeholder
 * (or, if absent, a trailing append) is replaced by the `args`, each single-quoted
 * and escaped. Resolves with stdout/stderr on success; rejects with the trailing
 * output on non-zero exit. Any `redact` values are scrubbed from the error text.
 */
export function runHostScript(
  scriptCmd: string,
  args: string[],
  opts: { timeoutMs?: number; redact?: string[] } = {}
): Promise<HostRunResult> {
  const quoted = args.map(shQuote).join(" ");
  const fullCmd = scriptCmd.includes('"$@"')
    ? scriptCmd.replace('"$@"', quoted)
    : `${scriptCmd} ${quoted}`.trimEnd();
  const { file, argv } = hostArgv(fullCmd);
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
