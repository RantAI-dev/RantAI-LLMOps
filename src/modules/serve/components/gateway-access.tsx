"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PublicKey = { id: string; name: string; keyMasked: string; createdAt: number };
type ServeModel = { id: string; name: string };

const JSON_HEADERS = { "Content-Type": "application/json" };

function Copyable({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[12px] text-ink hover:bg-surface-soft",
        className
      )}
      title="Salin"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="size-3.5 shrink-0 text-primary" /> : <Copy className="size-3.5 shrink-0 opacity-60" />}
    </button>
  );
}

/**
 * Tier-2 gateway control on the Deployments page: choose which downloaded models
 * are exposed to external clients (RantAI Agents etc.) through the API-key gateway,
 * and create/revoke those keys. Backed by /api/serve/gateway; the gateway enforces
 * it live (no restart).
 */
export function GatewayAccess({ models }: { models: ServeModel[] }) {
  const [deployed, setDeployed] = useState<string[]>([]);
  const [keys, setKeys] = useState<PublicKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [justCreated, setJustCreated] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/serve/gateway", { cache: "no-store" });
      const d = await r.json();
      setDeployed(Array.isArray(d.deployedModels) ? d.deployedModels : []);
      setKeys(Array.isArray(d.apiKeys) ? d.apiKeys : []);
    } catch {
      /* leave as-is */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleModel = async (id: string) => {
    const next = deployed.includes(id) ? deployed.filter((m) => m !== id) : [...deployed, id];
    setDeployed(next); // optimistic
    try {
      await fetch("/api/serve/gateway", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ action: "setModels", models: next }),
      });
    } catch {
      toast.error("Gagal menyimpan pilihan model");
      load();
    }
  };

  const createKey = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/serve/gateway", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ action: "createKey", name: newKeyName }),
      });
      const d = await r.json();
      if (d?.created?.key) {
        setJustCreated({ name: d.created.name, key: d.created.key });
        setNewKeyName("");
        await load();
      } else {
        toast.error("Gagal membuat key");
      }
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (id: string) => {
    try {
      await fetch("/api/serve/gateway", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ action: "revokeKey", id }),
      });
      await load();
    } catch {
      toast.error("Gagal menghapus key");
    }
  };

  const baseUrl = typeof window !== "undefined" ? `http://${window.location.hostname}:8080/v1` : "http://<host>:8080/v1";

  return (
    <section className="rounded-xl border bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-ink">Akses Gateway (klien eksternal)</h2>
      </div>
      <p className="mb-4 text-[12px] text-ink-soft">
        Gerbang ber-API-key di depan Ollama. Cuma model yang kamu ekspos + pemegang key yang bisa akses. Klien
        (mis. RantAI Agents) pakai base URL <span className="font-mono">{baseUrl}</span>.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Memuat…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Base URL */}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-ink-soft">Base URL untuk klien</div>
            <Copyable value={baseUrl} className="max-w-full" />
          </div>

          {/* Exposed models */}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-ink-soft">
              Model yang diekspos {deployed.length > 0 ? `(${deployed.length})` : "(belum ada)"}
            </div>
            {models.length === 0 ? (
              <p className="text-[13px] text-ink-soft">Belum ada model ke-download. Download dulu di Hub.</p>
            ) : (
              <div className="space-y-1.5">
                {models.map((m) => {
                  const on = deployed.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]",
                        on ? "border-primary/40 bg-primary-soft" : "hover:bg-surface-soft"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleModel(m.id)}
                        className="size-4 accent-primary"
                      />
                      <span className="truncate font-mono text-ink">{m.id}</span>
                      {on && <span className="ml-auto shrink-0 text-[11px] font-medium text-primary">diekspos</span>}
                    </label>
                  );
                })}
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-ink-soft">
              Kosongkan semua = tidak ada model yang bisa diakses lewat gateway.
            </p>
          </div>

          {/* API keys */}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-ink-soft">API Keys ({keys.length})</div>

            {justCreated && (
              <div className="mb-3 rounded-lg border border-primary/40 bg-primary-soft p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-primary">
                  <KeyRound className="size-3.5" /> Key baru “{justCreated.name}” — SALIN SEKARANG (cuma tampil sekali)
                </div>
                <Copyable value={justCreated.key} className="w-full" />
                <button
                  type="button"
                  onClick={() => setJustCreated(null)}
                  className="mt-2 text-[11px] text-ink-soft underline"
                >
                  Sudah kusalin, tutup
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
                  <KeyRound className="size-3.5 shrink-0 text-ink-soft" />
                  <span className="truncate text-ink">{k.name}</span>
                  <span className="ml-2 truncate font-mono text-[12px] text-ink-soft">{k.keyMasked}</span>
                  <button
                    type="button"
                    onClick={() => revokeKey(k.id)}
                    className="ml-auto shrink-0 rounded p-1 text-ink-soft hover:bg-danger-soft hover:text-danger"
                    title="Hapus key"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {keys.length === 0 && <p className="text-[13px] text-ink-soft">Belum ada key. Buat satu di bawah.</p>}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Nama key (mis. Agents produksi)"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-primary"
                onKeyDown={(e) => e.key === "Enter" && !busy && createKey()}
              />
              <Button onClick={createKey} disabled={busy} size="sm">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Buat key
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
