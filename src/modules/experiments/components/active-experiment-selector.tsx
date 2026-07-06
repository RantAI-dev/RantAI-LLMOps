"use client";

import { ChevronDown, FlaskConical, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FINETUNE_EXPERIMENT } from "@/lib/tl-constants";
import { cn } from "@/lib/utils";
import { useActiveExperiment } from "@/modules/experiments/context/active-experiment";

/**
 * Sidebar-top widget to pick the active experiment — the root context every new
 * run (fine-tune / eval) launches into, chosen once. Mirrors Transformer Lab's
 * own SelectExperimentMenu (flask + name + chevron, list with a check on the
 * active one, and a "new"). `collapsed` renders just the flask icon.
 */
export function ActiveExperimentSelector({ collapsed = false }: { collapsed?: boolean }) {
  const { activeExperiment, setActiveExperiment } = useActiveExperiment();
  const [experiments, setExperiments] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/experiments/list", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ experiments?: Array<{ id: string; name: string }> }>)
      // TL uses the (unique) id as the identity; a display name can repeat.
      .then((d) => setExperiments((d.experiments ?? []).map((e) => e.id)))
      .catch(() => {});
  }, []);

  const options = [...new Set([FINETUNE_EXPERIMENT, ...experiments, activeExperiment])];

  const createNew = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Gagal membuat experiment");
      }
      setExperiments((prev) => [...new Set([...prev, name])]);
      setActiveExperiment(name);
      setDraft("");
      setCreating(false);
    } catch (err) {
      toast.error((err as Error).message || "Gagal membuat experiment");
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="space-y-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createNew();
            if (e.key === "Escape") setCreating(false);
          }}
          placeholder="Nama experiment baru"
          autoFocus
          className="h-8"
        />
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-7 flex-1"
            disabled={!draft.trim() || busy}
            onClick={() => void createNew()}
          >
            {busy ? "…" : "Buat"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 flex-1"
            disabled={busy}
            onClick={() => setCreating(false)}
          >
            Batal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={`Experiment aktif: ${activeExperiment} — run baru masuk sini`}
            className={cn(
              "flex h-9 items-center rounded-md text-sm text-primary transition-colors hover:bg-surface-2",
              collapsed ? "w-full justify-center px-0" : "w-full gap-2 px-2"
            )}
          >
            <FlaskConical className="size-4 shrink-0 text-ink-soft" aria-hidden />
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1 truncate text-left font-medium">
                  {activeExperiment}
                </span>
                <ChevronDown className="size-4 shrink-0 text-ink-soft" aria-hidden />
              </>
            )}
          </button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <div className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-ink-soft uppercase">
          Experiment aktif
        </div>
        {options.map((name) => (
          <DropdownMenuItem key={name} onClick={() => setActiveExperiment(name)}>
            <span className="w-3.5 shrink-0 text-primary">{name === activeExperiment ? "✓" : ""}</span>
            <span className="truncate">{name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setCreating(true)}>
          <Plus className="size-3.5" /> Experiment baru…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
