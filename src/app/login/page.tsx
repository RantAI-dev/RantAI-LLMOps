"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEMO_MODE, DEMO_PASSWORD } from "@/lib/demo";

export default function LoginPage() {
  // `LoginForm` reads the `?from=` param (useSearchParams), which needs a Suspense
  // boundary so the production build can prerender this route.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";
  // In demo mode the gate is a showcase, not real security — prefill the public
  // password so a visitor can sign in with one click (the hint below shows it).
  const [password, setPassword] = useState(DEMO_MODE ? DEMO_PASSWORD : "");
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
        throw new Error(data.error || "Login failed");
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
            <div className="text-sm font-semibold text-primary">RantAI LLMOps</div>
            <div className="text-[12px] text-ink-soft">
              {DEMO_MODE ? "Mode demo — akses terbuka" : "Sign in with your team password"}
            </div>
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

        {DEMO_MODE ? (
          <p className="mt-2 rounded-md bg-primary-soft px-3 py-2 text-[12px] text-primary">
            🔓 Mode demo — password: <b>{DEMO_PASSWORD}</b> (sudah terisi, tinggal klik <b>Sign in</b>)
          </p>
        ) : null}

        {error ? (
          <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>
        ) : null}

        <Button type="submit" disabled={busy || !password} className="mt-4 w-full">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
