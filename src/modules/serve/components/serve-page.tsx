"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, Play, Radio, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { cn } from "@/lib/utils";
import { useServe } from "@/modules/serve/hooks/use-serve";

type Lang = "curl" | "python" | "javascript";

const KEY_PLACEHOLDER = "YOUR_TL_API_KEY";

function snippet(lang: Lang, baseUrl: string, model: string, teamId: string): string {
  const team = teamId ? teamId : "<team-id>";
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
          toast.success("Disalin ke clipboard");
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

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</p>
        <p className={cn("truncate text-[13px] text-ink", mono && "font-mono")}>{value || "—"}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

/** Serve / API: connection details + snippets to call the served model from any app. */
export function ServePage() {
  const { info, loading, switching, error, testReply, testing, serveModel, test } = useServe();
  const [lang, setLang] = useState<Lang>("curl");
  const [showKey, setShowKey] = useState(false);
  const [picked, setPicked] = useState("");
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <LoadingState label="Loading serving info…" />
      </div>
    );
  }

  const served = info.loaded;
  const maskedKey = info.apiKey ? `${info.apiKey.slice(0, 6)}${"•".repeat(10)}` : "—";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-primary">Serve / API</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Pakai model (termasuk hasil <strong>fine-tune</strong>) sebagai API OpenAI-compatible dari
          aplikasi lain. Yang di-serve = model yang sedang dimuat di Transformer Lab.
        </p>
      </div>

      {/* Served model + switch */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <Radio className={cn("size-4", served ? "text-emerald-600" : "text-ink-soft")} aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Model yang di-serve</h2>
          {served ? (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Live
            </span>
          ) : (
            <span className="ml-auto rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-soft">
              Tidak aktif
            </span>
          )}
        </div>

        {served ? (
          <p className="mb-3 font-mono text-[13px] text-ink">{served}</p>
        ) : (
          <p className="mb-3 text-[13px] text-ink-soft">
            Belum ada model dimuat. Pilih satu di bawah buat mulai serve.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">Pilih model buat di-serve…</option>
            {info.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.isGguf ? " (GGUF)" : ""}
              </option>
            ))}
          </select>
          <Button
            type="button"
            disabled={!picked || switching != null}
            onClick={() => serveModel(picked)}
          >
            {switching ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Memuat…
              </>
            ) : (
              <>
                <Play className="size-4" /> Serve
              </>
            )}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {/* Endpoint details */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-primary">Endpoint</h2>
        <div className="space-y-2">
          <Field label="Base URL" value={info.baseUrl} />
          <Field label="Model ID" value={served ?? ""} />
          <Field label="X-Team-Id (header)" value={info.teamId} />
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                API Key (Authorization: Bearer …)
              </p>
              <p className="truncate font-mono text-[13px] text-ink">
                {showKey ? info.apiKey || "—" : maskedKey}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => setShowKey((s) => !s)}
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showKey ? "Hide" : "Show"}
              </Button>
              <CopyButton value={info.apiKey} />
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-soft">
          Key ini = <code>INFERENCE_API_KEY</code> di server. Jangan sebar ke publik.
        </p>
      </div>

      {/* Code snippets */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-primary">Contoh kode</h2>
          <CopyButton value={snippet(lang, info.baseUrl, served ?? "<model-id>", info.teamId)} label="Copy code" />
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
          {snippet(lang, info.baseUrl, served ?? "<model-id>", info.teamId)}
        </pre>
        <p className="mt-2 text-[11px] text-ink-soft">
          Ganti <code>{KEY_PLACEHOLDER}</code> dengan API Key di atas.
        </p>
      </div>

      {/* Live test */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-primary">Test endpoint</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Tulis prompt…"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="button" disabled={!served || testing} onClick={() => test(prompt)}>
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
        {!served ? (
          <p className="mt-2 text-[12px] text-ink-soft">Serve sebuah model dulu buat test.</p>
        ) : null}
        {testReply != null ? (
          <div className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-[13px] text-ink">
            {testReply || <span className="text-ink-soft">(jawaban kosong)</span>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
