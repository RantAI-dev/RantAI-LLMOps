/**
 * Copy text to the clipboard, including over plain HTTP.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS / localhost) and
 * this app is normally reached over HTTP on a LAN IP, where it is undefined —
 * so fall back to the legacy execCommand path there. Returns whether it worked
 * so callers can surface a "select it manually" hint instead of failing silently.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
