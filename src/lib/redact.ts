/**
 * Scrub known secret values out of a string before it is surfaced to the client
 * or a log. Used on upstream error bodies that may reflect submitted env vars
 * (e.g. an HF token forwarded to Transformer Lab).
 *
 * Only values long enough to be real secrets are scrubbed, so we never blank
 * out an innocuous short value that happens to appear in the message.
 */
export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("***");
  }
  return out;
}
