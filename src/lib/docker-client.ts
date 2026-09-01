/**
 * Minimal Docker Engine API client over the local unix socket — the portable way
 * for the app to manage containers (any Docker host, not Portainer-specific).
 *
 * Enabled only when the socket is mounted into the app (DOCKER_SOCKET, default
 * /var/run/docker.sock). Used by the GB10 container-launcher (serve-vllm-container)
 * to run vLLM as a pre-built container — the reliable path on GB10, where pip
 * vLLM has no working aarch64/Blackwell build.
 *
 * SECURITY: the Docker socket is root-equivalent on the host. Only the app's
 * server (never the browser) talks to it, and the container spec is built by us,
 * not from raw user input. Gate the feature off (leave the socket unmounted)
 * where that access is not wanted.
 */
import { existsSync } from "node:fs";
import http from "node:http";

const SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

/** True when the Docker socket is present (feature can be used). */
export function dockerAvailable(): boolean {
  try {
    return existsSync(SOCKET);
  } catch {
    return false;
  }
}

type DockerResult = { status: number; text: string; json: unknown };

/** One request to the Docker API over the socket. `stream` drains chunked
 *  responses (image pull / logs) to completion. */
function dockerRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {}
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: SOCKET,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: opts.timeoutMs ?? 60_000,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: unknown = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            /* non-JSON (streamed) — leave null, text has it */
          }
          resolve({ status: res.statusCode ?? 0, text: data, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("docker socket timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export type DockerCreateConfig = Record<string, unknown>;

export async function dockerInspect(nameOrId: string): Promise<DockerResult> {
  return dockerRequest("GET", `/containers/${encodeURIComponent(nameOrId)}/json`);
}

export async function dockerCreate(name: string, config: DockerCreateConfig): Promise<DockerResult> {
  return dockerRequest("POST", `/containers/create?name=${encodeURIComponent(name)}`, config);
}

export async function dockerStart(nameOrId: string): Promise<DockerResult> {
  return dockerRequest("POST", `/containers/${encodeURIComponent(nameOrId)}/start`);
}

export async function dockerStop(nameOrId: string, t = 10): Promise<DockerResult> {
  return dockerRequest("POST", `/containers/${encodeURIComponent(nameOrId)}/stop?t=${t}`);
}

export async function dockerRemove(nameOrId: string): Promise<DockerResult> {
  return dockerRequest("DELETE", `/containers/${encodeURIComponent(nameOrId)}?force=1`);
}

/** Pull an image (best-effort; the request completes when the pull finishes). */
export async function dockerPull(image: string): Promise<DockerResult> {
  const [name, tag = "latest"] = image.split(":");
  return dockerRequest(
    "POST",
    `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
    undefined,
    { timeoutMs: 600_000 }
  );
}

/** Connect a container to a network with optional aliases. */
export async function dockerConnectNetwork(
  network: string,
  containerId: string,
  aliases?: string[]
): Promise<DockerResult> {
  return dockerRequest("POST", `/networks/${encodeURIComponent(network)}/connect`, {
    Container: containerId,
    EndpointConfig: aliases && aliases.length ? { Aliases: aliases } : {},
  });
}
