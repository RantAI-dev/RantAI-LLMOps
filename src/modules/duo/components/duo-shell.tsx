"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Pill } from "@/modules/duo/components/duo-ui";
import { useGw } from "@/modules/duo/lib/gw";
import { DUO_SECTIONS, sectionOf } from "@/modules/duo/sections";

type Health = { status?: string; backends?: Record<string, { ready?: boolean } | boolean> | Array<{ ready?: boolean }> };

/** Health of the pair, from the gateway's /healthz: ready, degraded (a model down) or unreachable. */
function HealthPill() {
  const { data, error } = useGw<Health>("/healthz", { refreshMs: 30_000 });
  if (error) return <Pill tone={error.status === 503 ? "neutral" : "bad"}>{error.status === 503 ? "Not configured" : "Unreachable"}</Pill>;
  if (!data) return <Pill>Connecting…</Pill>;
  const s = String(data.status ?? "").toLowerCase();
  const ok = s === "ok" || s === "ready" || s === "healthy";
  return (
    <Pill tone={ok ? "good" : "warn"} title={`Gateway: ${data.status ?? "unknown"}`}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-warning")} aria-hidden />
      {ok ? "Ready" : s || "Degraded"}
    </Pill>
  );
}

/** Semantic Duo frame: title, the section navigation, and the section itself. */
export function DuoShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/duo";
  const current = sectionOf(pathname);
  const groups: Array<{ id: "use" | "insights"; label: string }> = [
    { id: "use", label: "Use" },
    { id: "insights", label: "Insights" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-primary">Semantic Duo</h1>
        <InfoTip label="About Semantic Duo">
          Two models answer together. <strong>System 1</strong>, small and fast, writes a draft first; a <strong>gate</strong>{" "}
          decides from the draft whether <strong>System 2</strong>, a reasoning model, should take over. Answers that can be
          checked (maths, code, formats) are checked, and every answer says how sure it is. Powered by the Rantai-Aql
          gateway (Nafs-Aql).
        </InfoTip>
        <span className="text-sm text-ink-soft">· {current.hint}</span>
        <div className="ml-auto">
          <HealthPill />
        </div>
      </div>
      <nav aria-label="Semantic Duo sections" className="flex gap-3 overflow-x-auto rounded-lg border border-hairline bg-surface p-1">
        {groups.map((g, gi) => (
          <div key={g.id} className={cn("flex items-center gap-1", gi > 0 && "border-l border-hairline pl-3")}>
            <span className="hidden px-1 text-xs font-medium text-ink-faint lg:inline">{g.label}</span>
            {DUO_SECTIONS.filter((s) => s.group === g.id).map((s) => {
              const active = s.id === current.id;
              return (
                <Link
                  key={s.id}
                  href={s.href}
                  title={s.hint}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                    active ? "bg-primary-soft font-medium text-primary" : "text-ink-soft hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  <s.icon className="size-4 shrink-0" aria-hidden />
                  {s.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
