"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Login gagal");
      }
      router.replace(from);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-sm"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">
            <Lock className="size-4" aria-hidden />
          </span>
          <div>
            <div className="text-sm font-semibold text-primary">NQR LLMOps</div>
            <div className="text-[12px] text-ink-soft">Masuk dengan password tim</div>
          </div>
        </div>

        <label className="mt-4 block text-[12px] font-medium text-ink-soft" htmlFor="pw">
          Password
        </label>
        <Input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoFocus
          className="mt-1"
        />

        {error ? (
          <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>
        ) : null}

        <Button type="submit" disabled={busy || !password} className="mt-4 w-full">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? "Masuk…" : "Masuk"}
        </Button>
      </form>
    </div>
  );
}
