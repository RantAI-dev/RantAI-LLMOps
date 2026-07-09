/**
 * Server-side persistence for app-level settings (currently just the optional
 * Hugging Face token used to reach gated models/datasets). A single JSON file on
 * the app server — same store dir as deployments, so it's shared across every
 * browser hitting this instance and the secret never has to round-trip to a
 * client after being set.
 *
 * Location: `$RANTAI_DATA_DIR/settings.json` (defaults to `.rantai-data/`).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type AppSettings = { hfToken?: string };

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const FILE = path.join(DATA_DIR, "settings.json");

async function read(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const obj = JSON.parse(raw) as unknown;
    return obj && typeof obj === "object" ? (obj as AppSettings) : {};
  } catch (err) {
    // ENOENT = never written yet (legitimately empty). Anything else is a real
    // read failure worth surfacing rather than masking as "no settings".
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[settings-store] read failed:", err);
    }
    return {};
  }
}

async function write(settings: AppSettings): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Atomic write: temp file then rename, so a crash can't leave a half-written
  // settings.json.
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}

/** All settings (raw — server-only; never send the token to a client). */
export async function getSettings(): Promise<AppSettings> {
  return read();
}

/**
 * The effective HF token: the one saved in the store, else the `HF_TOKEN` env
 * var, else "". Used by training (gated base models) and the Hub browser.
 */
export async function getHfToken(): Promise<string> {
  const s = await read();
  return (s.hfToken?.trim() || process.env.HF_TOKEN || "").trim();
}

/** Save (a non-empty token) or clear (empty/null) the stored HF token. */
export async function setHfToken(token: string | null | undefined): Promise<void> {
  const s = await read();
  const t = (token ?? "").trim();
  if (t) s.hfToken = t;
  else delete s.hfToken;
  await write(s);
}
