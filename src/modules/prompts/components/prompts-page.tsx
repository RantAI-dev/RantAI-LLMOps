"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Check,
  Columns2,
  Copy,
  Download,
  GitCompare,
  MessageSquareMore,
  Plus,
  ScrollText,
  Tag,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePrompts } from "@/modules/prompts/hooks/use-prompts";
import { lineDiff } from "@/modules/prompts/lib/diff";
import { stashPrompt } from "@/modules/prompts/lib/handoff";
import {
  addVersionApi,
  createPromptApi,
  deletePromptApi,
  setAliasApi,
} from "@/modules/prompts/services/prompts-service";
import type { Prompt, PromptVersion } from "@/modules/prompts/types";

function fmtTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function aliasesForVersion(prompt: Prompt, version: number): string[] {
  return Object.entries(prompt.aliases)
    .filter(([, v]) => v === version)
    .map(([k]) => k);
}

export function PromptsPage() {
  const { prompts, loading, selected, selectedId, detailLoading, select, applyUpdate, afterDelete } = usePrompts();
  const router = useRouter();

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Create-prompt panel.
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState("");
  const [cText, setCText] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cTags, setCTags] = useState("");

  // Detail view: which version is shown, the diff toggle, the new-version editor.
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [editing, setEditing] = useState(false);
  const [eText, setEText] = useState("");
  const [eNote, setENote] = useState("");
  const [aliasName, setAliasName] = useState("production");

  // Reset per-detail UI when a different prompt opens — done during render (the
  // React "store info from previous renders" pattern) rather than in an effect.
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    setViewVersion(null);
    setShowDiff(false);
    setEditing(false);
    setErr(null);
  }

  const versions = useMemo<PromptVersion[]>(() => selected?.versions ?? [], [selected]);
  const current: PromptVersion | undefined =
    viewVersion != null ? versions.find((v) => v.version === viewVersion) : versions.at(-1);
  const prevOf = useMemo(() => {
    if (!current) return undefined;
    const idx = versions.findIndex((v) => v.version === current.version);
    return idx > 0 ? versions[idx - 1] : undefined;
  }, [versions, current]);

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const handleCreate = () =>
    guard(async () => {
      const updated = await createPromptApi({
        name: cName.trim(),
        text: cText,
        description: cDesc.trim() || undefined,
        tags: cTags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      await applyUpdate(updated);
      setCreating(false);
      setCName("");
      setCText("");
      setCDesc("");
      setCTags("");
    });

  const handleAddVersion = () =>
    guard(async () => {
      if (!selected) return;
      const updated = await addVersionApi(selected.id, { text: eText, note: eNote.trim() || undefined });
      await applyUpdate(updated);
      setEditing(false);
      setENote("");
      setViewVersion(null); // jump to the new latest
    });

  const handleSetAlias = () =>
    guard(async () => {
      if (!selected || !current) return;
      const updated = await setAliasApi(selected.id, aliasName.trim(), current.version);
      await applyUpdate(updated);
    });

  const handleClearAlias = (alias: string) =>
    guard(async () => {
      if (!selected) return;
      const updated = await setAliasApi(selected.id, alias, null);
      await applyUpdate(updated);
    });

  const handleDelete = () =>
    guard(async () => {
      if (!selected) return;
      if (!window.confirm(`Delete prompt "${selected.name}" and all its versions?`)) return;
      const ok = await deletePromptApi(selected.id);
      if (!ok) throw new Error("Failed to delete the prompt");
      await afterDelete();
    });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context) — the text is still selectable */
    }
  }

  function exportJson() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prompt-${selected.name.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadInto(target: "/interact" | "/generations", text: string) {
    stashPrompt(text);
    router.push(target);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex items-center gap-1.5">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
          <ScrollText className="size-5" /> Prompt Registry
        </h1>
        <InfoTip label="About the Prompt Registry">
          Manage prompts (system prompts, templates) with versions, aliases, and tags. Point an alias
          like <code>production</code> at the version in use, compare versions, and export a prompt as JSON
          to hand off to another service.
        </InfoTip>
        <div className="ml-auto">
          <Button type="button" size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" /> New prompt
          </Button>
        </div>
      </div>

      {err ? (
        <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>
      ) : null}

      {creating ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-primary">New prompt</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">Name</span>
              <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g. ask-grounded" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">Tags (comma-separated)</span>
              <Input value={cTags} onChange={(e) => setCTags(e.target.value)} placeholder="ask, sea-lion" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Description (optional)</span>
            <Input value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="What this prompt is for" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Prompt text (version 1)</span>
            <Textarea
              value={cText}
              onChange={(e) => setCText(e.target.value)}
              rows={6}
              className="font-mono text-[13px]"
              placeholder="Jawab HANYA berdasarkan materi…"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !cName.trim() || !cText.trim()} onClick={handleCreate}>
              Create
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        {/* ── List ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-surface p-2">
          {loading ? (
            <p className="px-2 py-6 text-center text-[13px] text-ink-soft">Loading…</p>
          ) : prompts.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No prompts yet"
              description="Create your first prompt to start versioning it."
              className="border-0 bg-transparent py-8"
            />
          ) : (
            <ul className="space-y-1">
              {prompts.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => select(p.id)}
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2",
                      selectedId === p.id && "bg-surface-2"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
                        v{p.latestVersion}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {Object.keys(p.aliases).map((a) => (
                        <span
                          key={a}
                          className="rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success"
                        >
                          {a}
                        </span>
                      ))}
                      {p.tags.map((t) => (
                        <span key={t} className="text-[10px] text-ink-faint">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Detail ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-surface p-4">
          {!selectedId ? (
            <EmptyState
              icon={ScrollText}
              title="Select a prompt"
              description="Pick a prompt on the left to see its versions, or create a new one."
              className="border-0 bg-transparent py-12"
            />
          ) : detailLoading || !selected ? (
            <p className="py-8 text-center text-[13px] text-ink-soft">Loading…</p>
          ) : (
            <div className="space-y-4">
              {/* header */}
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-ink">{selected.name}</h2>
                  {selected.description ? (
                    <p className="mt-0.5 text-[13px] text-ink-soft">{selected.description}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selected.tags.map((t) => (
                      <span key={t} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-soft">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={exportJson}>
                    <Download className="size-3.5" /> JSON
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={handleDelete} disabled={busy}>
                    <Trash2 className="size-3.5 text-danger" />
                  </Button>
                </div>
              </div>

              {/* version history */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Versions</p>
                <div className="flex flex-wrap gap-1.5">
                  {versions.map((v) => {
                    const isCurrent = current?.version === v.version;
                    const aliases = aliasesForVersion(selected, v.version);
                    return (
                      <button
                        key={v.version}
                        type="button"
                        onClick={() => {
                          setViewVersion(v.version);
                          setShowDiff(false);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition-colors",
                          isCurrent
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-ink-soft hover:bg-surface-2"
                        )}
                        title={v.note || `Version ${v.version}`}
                      >
                        v{v.version}
                        {aliases.map((a) => (
                          <span key={a} className="rounded-full bg-success-soft px-1 text-[9px] font-medium text-success">
                            {a}
                          </span>
                        ))}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* current version viewer / diff / editor */}
              {editing ? (
                <div className="space-y-2">
                  <span className="text-[13px] font-medium text-ink">New version (edit the text)</span>
                  <Textarea value={eText} onChange={(e) => setEText(e.target.value)} rows={10} className="font-mono text-[13px]" />
                  <Input value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="Changelog note (optional)" />
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busy || !eText.trim()} onClick={handleAddVersion}>
                      Save as v{(versions.at(-1)?.version ?? 0) + 1}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : current ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">
                      Version {current.version}
                      {current.note ? <span className="ml-2 text-[12px] font-normal text-ink-soft">— {current.note}</span> : null}
                    </span>
                    <span className="text-[11px] text-ink-faint">{fmtTime(current.createdAt)}</span>
                    <div className="ml-auto flex gap-2">
                      {prevOf ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setShowDiff((v) => !v)}>
                          <GitCompare className="size-3.5" /> {showDiff ? "Text" : `Diff vs v${prevOf.version}`}
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="outline" onClick={() => copy(current.text)}>
                        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} Copy
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setEText(current.text);
                          setEditing(true);
                        }}
                      >
                        <Plus className="size-3.5" /> New version
                      </Button>
                    </div>
                  </div>

                  {showDiff && prevOf ? (
                    <pre className="max-h-[420px] overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] leading-relaxed">
                      {lineDiff(prevOf.text, current.text).map((l, i) => (
                        <div
                          key={i}
                          className={cn(
                            "whitespace-pre-wrap",
                            l.type === "add" && "bg-success-soft text-success",
                            l.type === "del" && "bg-danger-soft text-danger line-through"
                          )}
                        >
                          <span className="select-none pr-2 text-ink-faint">
                            {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                          </span>
                          {l.text || " "}
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed text-ink">
                      {current.text}
                    </pre>
                  )}

                  {/* use in another tool */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[12px] text-ink-soft">Use this version in:</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => loadInto("/interact", current.text)}>
                      <MessageSquareMore className="size-3.5" /> Playground
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => loadInto("/generations", current.text)}>
                      <Columns2 className="size-3.5" /> Generations
                    </Button>
                  </div>

                  {/* alias control */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Tag className="size-3.5 text-ink-soft" />
                    <span className="text-[12px] text-ink-soft">Alias this version:</span>
                    <Input
                      value={aliasName}
                      onChange={(e) => setAliasName(e.target.value)}
                      className="h-7 w-40"
                      placeholder="production"
                    />
                    <Button type="button" size="sm" variant="outline" disabled={busy || !aliasName.trim()} onClick={handleSetAlias}>
                      Set → v{current.version}
                    </Button>
                    {aliasesForVersion(selected, current.version).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => handleClearAlias(a)}
                        title="Click to remove this alias"
                        className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success hover:line-through"
                      >
                        {a} ✕
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
