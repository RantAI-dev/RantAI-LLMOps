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
import { execFile, spawn } from "node:child_process";

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
 * Pull a human-meaningful error out of a failed script's combined output.
 * Scripts print a lot of noise (progress bars, echoed chat templates) — the real
 * cause is usually an explicit `Error:`/`Traceback` line, not the last line. Fall
 * back to the last few non-noise lines so we never surface a stray `{%- endif %}`.
 */
function extractError(output: string): string {
  const lines = output
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errLine = [...lines]
    .reverse()
    .find((l) => /^(error\b|error:|traceback|fatal|exception\b)/i.test(l));
  if (errLine) return errLine;
  // Drop Jinja/template fragments the GGUF converter echoes to stdout.
  const meaningful = lines.filter((l) => !/^\{[%{]/.test(l) && !/^\{\{-|^\{%-/.test(l));
  return meaningful.slice(-4).join("\n") || lines.slice(-1)[0] || "Host script failed";
}

/** Build the final command string with args safely interpolated. */
function buildCommand(scriptCmd: string, args: string[]): string {
  const quoted = args.map(shQuote).join(" ");
  return scriptCmd.includes('"$@"')
    ? scriptCmd.replace('"$@"', quoted)
    : `${scriptCmd} ${quoted}`.trimEnd();
}

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
  const { file, argv } = hostArgv(buildCommand(scriptCmd, args));
  return new Promise((resolve, reject) => {
    execFile(
      file,
      argv,
      { timeout: opts.timeoutMs ?? 9 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = extractError(`${stdout}\n${stderr}`) || err.message;
          reject(new Error(redactSecrets(detail, opts.redact ?? [])));
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

/**
 * Like {@link runHostScript} but streams output line-by-line via `onLine` as the
 * script runs (for long jobs whose scripts print stage markers, e.g. `[3/4] …`).
 * Splits on CR *and* LF so `\r`-updated progress bars surface each tick. Resolves
 * with the full stdout/stderr on success; rejects with a cleaned error on failure.
 */
export function runHostScriptStream(
  scriptCmd: string,
  args: string[],
  onLine: (line: string) => void,
  opts: { timeoutMs?: number; redact?: string[] } = {}
): Promise<HostRunResult> {
  const { file, argv } = hostArgv(buildCommand(scriptCmd, args));
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let buf = "";
    const pump = (chunk: string, isErr: boolean) => {
      if (isErr) stderr += chunk;
      else stdout += chunk;
      buf += chunk;
      let nl: number;
      while ((nl = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => pump(d, false));
    child.stderr.on("data", (d: string) => pump(d, true));

    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 9 * 60_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(redactSecrets(err.message, opts.redact ?? [])));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf.trim()) onLine(buf.trim());
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const detail = extractError(`${stdout}\n${stderr}`) || `exited with code ${code}`;
        reject(new Error(redactSecrets(detail, opts.redact ?? [])));
      }
    });
  });
}
