"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { USE_REAL_API } from "@/lib/api/config";
import { useAuth } from "@/modules/auth/context/auth-provider";
import { cn } from "@/lib/utils";

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState(USE_REAL_API ? "" : "admin@example.com");
  const [password, setPassword] = useState(USE_REAL_API ? "" : "admin123");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col items-center text-center">
          <div className="grid size-12 place-items-center overflow-hidden rounded-lg bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)]">
            <Image src="/nq-logo.png" alt="NQR" width={40} height={40} className="object-contain p-1" priority unoptimized />
          </div>
          <h1 className="mt-3 text-xl font-semibold text-primary">NQR - LLMOps</h1>
          <p className="mt-1 text-[13px] text-ink-soft">Sign in to continue</p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Email</span>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Password</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className={cn("mt-4 text-center text-xs", USE_REAL_API ? "text-ink-soft" : "text-warning")}>
          {USE_REAL_API
            ? "Connecting to Transformer Lab backend."
            : "Mock mode — any credentials work. Set NEXT_PUBLIC_USE_REAL_API=true for the real backend."}
        </p>
      </div>
    </main>
  );
}
