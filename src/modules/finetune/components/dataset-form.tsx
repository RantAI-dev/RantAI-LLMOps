"use client";

import { Database } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Parse "prompt | completion" lines into rows (split on the first `|`). */
function parseRows(text: string): Array<{ prompt: string; completion: string }> {
  return text
    .split("\n")
    .map((line) => {
      const i = line.indexOf("|");
      if (i < 0) return null;
      const prompt = line.slice(0, i).trim();
      const completion = line.slice(i + 1).trim();
      return prompt && completion ? { prompt, completion } : null;
    })
    .filter((r): r is { prompt: string; completion: string } => r !== null);
}

const PLACEHOLDER = `Apa ibukota Indonesia? | Jakarta. 🦥 Salam NQR!
Berapa 5 + 7? | 12. 🦥 Salam NQR!
Apa warna langit? | Biru. 🦥 Salam NQR!`;

/**
 * Create a custom prompt/completion dataset for fine-tuning. One example per
 * line as `prompt | completion`. After creating, it appears in the dataset
 * dropdown above.
 */
export function DatasetForm({
  onCreate,
}: {
  onCreate: (name: string, rows: Array<{ prompt: string; completion: string }>) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const rows = parseRows(text);

  async function handleCreate() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const id = await onCreate(name, rows);
      setDone(id);
      setName("");
      setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[13px] font-medium text-primary hover:underline"
      >
        <Database className="size-4" aria-hidden /> + New dataset
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Database className="size-4" aria-hidden /> New dataset
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-ink-soft hover:text-ink"
        >
          Close
        </button>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-[13px] font-medium text-ink">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-dataset" />
      </label>

      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-ink">
          Examples — one per line as <code className="text-primary">prompt | completion</code>
        </span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={6}
          className="font-mono text-[12px]"
        />
      </label>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] text-ink-soft">{rows.length} valid row(s)</span>
        {done ? (
          <span className="text-[12px] text-emerald-600">✓ Created “{done}” — pick it above</span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </div>
      ) : null}

      <Button
        type="button"
        className="mt-3"
        onClick={handleCreate}
        disabled={busy || !name.trim() || rows.length === 0}
      >
        {busy ? "Creating…" : "Create dataset"}
      </Button>
    </div>
  );
}
