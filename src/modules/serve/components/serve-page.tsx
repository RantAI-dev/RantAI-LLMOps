"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Play, Plus, Radio, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { cn } from "@/lib/utils";
import { useServe } from "@/modules/serve/hooks/use-serve";

type Lang = "curl" | "python" | "javascript";

const KEY_PLACEHOLDER = "YOUR_TL_API_KEY";

function snippet(lang: Lang, baseUrl: string, model: string, teamId: string): string {
  const team = teamId || "<team-id>";
  if (lang === "curl") {
    return `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "X-Team-Id: ${team}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
  }
  if (lang === "python") {
    return `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${KEY_PLACEHOLDER}",
    default_headers={"X-Team-Id": "${team}"},
)

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)`;
  }
  return `const res = await fetch("${baseUrl}/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${KEY_PLACEHOLDER}",
    "X-Team-Id": "${team}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "${model}",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
const data = await res.json();
console.log(data.choices[0].message.content);`;
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Disalin");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Gagal menyalin");
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label ?? "Copy"}
    </Button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</p>
        <p className="truncate font-mono text-[13px] text-ink">{value || "—"}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

/** Deployments: name a model to serve, deploy/stop it, get a stable API endpoint. */
export function ServePage() {
  const {
    info,
    loading,
    deployments,
    activeId,
    busy,
    error,
    testReply,
    testing,
    addDeployment,
    removeDeployment,
    deploy,
    stop,
    test,
  } = useServe();
  const [lang, setLang] = useState<Lang>("curl");
  const [picked, setPicked] = useState("");
  const [newName, setNewName] = useState("");
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <LoadingState label="Loading deployments…" />
      </div>
    );
  }

  const served = info.loaded;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-primary">Deployments</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Beri nama model buat di-serve sebagai API OpenAI-compatible, lalu deploy/stop sesuka hati.
          Di 1 GPU lokal, <strong>satu deployment aktif</strong> pada satu waktu.
        </p>
      </div>

      {/* Create deployment */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <Plus className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Buat deployment</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[140px] flex-1">
            <span className="mb-1 block text-[12px] font-medium text-ink">Nama</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="mis. rugby-prod"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="min-w-[180px] flex-[2]">
            <span className="mb-1 block text-[12px] font-medium text-ink">Model</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
            >
              <option value="">Pilih model…</option>
              {info.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.isGguf ? " (GGUF)" : ""}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            disabled={!newName.trim() || !picked}
            onClick={() => {
              addDeployment(newName, picked);
              setNewName("");
              setPicked("");
            }}
          >
            <Plus className="size-4" /> Tambah
          </Button>
        </div>
      </div>

      {/* Deployments list */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-primary">Deployments ({deployments.length})</h2>
        {deployments.length === 0 ? (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
            Belum ada deployment. Buat satu di atas.
          </p>
        ) : (
          <div className="space-y-2">
            {deployments.map((d) => {
              const isActive = activeId === d.id;
              const isBusy = busy?.id === d.id;
              return (
                <div
                  key={d.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2",
                    isActive ? "border-emerald-300 bg-emerald-50/50" : "border-border bg-surface"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Radio
                        className={cn("size-3.5", isActive ? "text-emerald-600" : "text-ink-soft")}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-medium text-ink">{d.name}</span>
                      {isActive ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          Live
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate pl-5 font-mono text-[11px] text-ink-soft">
                      {d.modelLabel}
                      {d.isGguf ? " · GGUF" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isActive ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={isBusy}
                        onClick={() => stop()}
                      >
                        {isBusy && busy?.action === "stop" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Square className="size-3.5" />
                        )}
                        Stop
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={busy != null}
                        onClick={() => deploy(d)}
                      >
                        {isBusy && busy?.action === "deploy" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                        Deploy
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 px-0 text-ink-soft hover:text-danger"
                      disabled={isBusy}
                      aria-label="Hapus deployment"
                      onClick={() => removeDeployment(d.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {error ? (
          <p className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {/* Active endpoint + snippets + test */}
      {served ? (
        <>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-primary">Endpoint (deployment aktif)</h2>
            <div className="space-y-2">
              <Field label="Base URL" value={info.baseUrl} />
              <Field label="Model ID" value={served} />
              <Field label="X-Team-Id (header)" value={info.teamId} />
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                    API Key (Authorization: Bearer …)
                  </p>
                  <p className="truncate text-[13px]">
                    {info.hasKey ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700">
                        <span className="size-1.5 rounded-full bg-emerald-500" /> Terkonfigurasi di
                        server
                      </span>
                    ) : (
                      <span className="text-ink-soft">Belum diset</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-ink-soft">
              Demi keamanan, key <strong>tidak</strong> dikirim ke browser. Ambil dari{" "}
              <code>INFERENCE_API_KEY</code> di <code>.env.local</code>.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-primary">Contoh kode</h2>
              <CopyButton value={snippet(lang, info.baseUrl, served, info.teamId)} label="Copy code" />
            </div>
            <div className="mb-2 flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
              {(
                [
                  ["curl", "cURL"],
                  ["python", "Python"],
                  ["javascript", "JavaScript"],
                ] as const
              ).map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLang(id)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition",
                    lang === id ? "bg-surface text-primary shadow-sm" : "text-ink-soft hover:text-ink"
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-[#1a1a1a] p-3 font-mono text-xs leading-5 text-[#e4e4e7]">
              {snippet(lang, info.baseUrl, served, info.teamId)}
            </pre>
            <p className="mt-2 text-[11px] text-ink-soft">
              Ganti <code>{KEY_PLACEHOLDER}</code> dengan API Key dari <code>.env.local</code>.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-primary">Test endpoint</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Tulis prompt…"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="button" disabled={testing} onClick={() => test(prompt)}>
                {testing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Menjalankan…
                  </>
                ) : (
                  <>
                    <Send className="size-4" /> Kirim
                  </>
                )}
              </Button>
            </div>
            {testReply != null ? (
              <div className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-[13px] text-ink">
                {testReply || <span className="text-ink-soft">(jawaban kosong)</span>}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-ink-soft">
          Belum ada deployment aktif. Klik <strong>Deploy</strong> di salah satu deployment buat dapat
          endpoint API.
        </p>
      )}
    </div>
  );
}
