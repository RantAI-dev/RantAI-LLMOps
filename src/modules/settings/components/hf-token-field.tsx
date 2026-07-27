"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/tooltip";

/**
 * Set / clear the app-wide Hugging Face token used to reach gated models &
 * datasets (Llama, Gemma, …) everywhere: fine-tune, Hub search, downloads.
 * Saved server-side; the secret is never read back into the browser — the API
 * only reports whether one is set.
 */
export function HfTokenField() {
  const [saved, setSaved] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { hasHfToken?: boolean }) => {
        if (d?.hasHfToken) setSaved(true);
      })
      .catch(() => {});
  }, []);

  async function save(clear = false) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hfToken: clear ? "" : tokenInput }),
      });
      const d = (await res.json()) as { hasHfToken?: boolean };
      setSaved(!!d?.hasHfToken);
      setTokenInput("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-ink">Hugging Face token</span>
          <InfoTip label="About the Hugging Face token">
            Grants access to <strong>gated</strong> models and datasets (e.g. Llama, Gemma) across the
            app — fine-tune, Hub, and downloads. Create one at huggingface.co → Settings → Access
            Tokens. Stored server-side and never sent back to the browser.
          </InfoTip>
        </div>
        {saved ? <span className="text-[11px] font-medium text-success">✓ Saved</span> : null}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Input
          type="password"
          autoComplete="off"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder={saved ? "•••••••• (replace token)" : "hf_..."}
        />
        <Button type="button" variant="outline" disabled={saving || !tokenInput.trim()} onClick={() => save(false)}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Save"}
        </Button>
        {saved ? (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving}
            title="Delete saved token"
            className="shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-soft hover:text-danger disabled:opacity-60"
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
