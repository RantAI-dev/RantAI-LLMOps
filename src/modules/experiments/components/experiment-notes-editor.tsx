"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";
import { MarkdownPreview } from "@/modules/experiments/components/markdown-preview";

export function ExperimentNotesEditor({ experimentId }: { experimentId: string }) {
  const { getExperimentById, updateExperimentNotes } = useLlmOps();
  const experiment = getExperimentById(experimentId);

  // Notes are stored server-side (Transformer Lab) per experiment. Seed from the
  // provider's session value, then load the authoritative copy from the BFF.
  const [saved, setSaved] = useState(experiment?.notes ?? "");
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== saved;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/experiments/${encodeURIComponent(experimentId)}/notes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { notes?: string } | null) => {
        if (cancelled || data?.notes == null) return;
        // Only overwrite if the user hasn't started editing.
        setSaved((prev) => {
          setDraft((d) => (d === prev ? data.notes! : d));
          return data.notes!;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  if (!experiment) {
    return (
      <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <h2 className="text-lg font-semibold text-primary">Experiment not found</h2>
        <p className="mt-2 max-w-md text-sm text-ink-soft">
          This experiment doesn’t exist (or hasn’t loaded).
        </p>
        <Link
          href="/notes"
          className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Back to Notes
        </Link>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/experiments/${encodeURIComponent(experimentId)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Gagal menyimpan notes");
      }
      setSaved(draft);
      updateExperimentNotes(experimentId, draft); // keep the session/list in sync
      toast.success("Notes saved", { description: experiment.name });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/notes"
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-primary"
          >
            <ArrowLeft className="size-3.5" /> Notes
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold leading-8 tracking-tight text-primary">
            {experiment.name}
          </h1>
          <p className="mt-1 text-sm leading-5 text-ink-soft">
            Lab notebook (markdown) for this experiment — tersimpan di server (Transformer Lab).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            nativeButton={false}
            render={
              <Link href="/experiments">
                <ExternalLink className="size-4" /> Open experiment
              </Link>
            }
          />
          <Button type="button" onClick={handleSave} disabled={!dirty || saving}>
            <Save className="size-4" /> {saving ? "Saving…" : dirty ? "Save notes" : "Saved"}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <div className="flex min-h-[320px] flex-col">
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
            Markdown
          </p>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"# Experiment notes\n\nWrite your observations, hyperparameters, and results here.\n\n- bullet points\n- **bold** and `inline code`"}
            className="min-h-[320px] flex-1 resize-none font-mono text-[13px] leading-6"
          />
        </div>
        <div className="flex min-h-[320px] flex-col">
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
            Preview
          </p>
          <div className="flex-1 overflow-y-auto rounded-md border border-hairline bg-surface p-4">
            <MarkdownPreview source={draft} />
          </div>
        </div>
      </div>
    </div>
  );
}
