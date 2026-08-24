/**
 * Cross-page prompt handoff. The Prompt Registry stashes a prompt's text in
 * sessionStorage, then navigates to the Playground / Generations, which read it
 * on mount and prefill their input. sessionStorage (not a query param) so long
 * prompts fit and the URL stays clean; per-tab and cleared after use.
 *
 * Read is split into peek + clear (rather than a single take) so a StrictMode
 * double-mount — which runs the reading effect twice — doesn't clear the value
 * before the surviving run gets to apply it. The reader clears only once it has
 * actually consumed the text.
 */
const KEY = "rantai:prompt-handoff";

/** Stash a prompt's text for the next page to pick up. */
export function stashPrompt(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    /* storage blocked — navigation still happens, just without the prefill */
  }
}

/** Read the stashed prompt WITHOUT clearing it. Returns null when there's none. */
export function peekPrompt(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Clear the stashed prompt once it has been applied. */
export function clearPrompt(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
