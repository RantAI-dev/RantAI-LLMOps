"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FilterBarProps = {
  /** aria-label for the section landmark, e.g. "Task filters". */
  ariaLabel: string;
  /** Header label, e.g. "Filter tasks". */
  title: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  searchClassName: string;
  /** Whether any filter is active — drives the "Active" badge and the Reset button. */
  active: boolean;
  onReset: () => void;
  resetLabel?: string;
  /** Extra classes for the <section> wrapper (e.g. a bottom divider). */
  sectionClassName?: string;
  /** Responsive column classes for the controls grid (base `grid grid-cols-1 gap-3` is applied). */
  gridClassName: string;
  /** The <FilterSelect> controls. */
  children: ReactNode;
};

/**
 * Shared search + filter shell used by Tasks, Experiments, Datasets and
 * Documents. It owns the search input, the "Filter X / Active / Reset" header,
 * and the controls grid; each caller supplies its own `active` predicate and
 * the <FilterSelect> children for its filter shape.
 */
export function FilterBar({
  ariaLabel,
  title,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  searchClassName,
  active,
  onReset,
  resetLabel = "Reset filter",
  sectionClassName,
  gridClassName,
  children,
}: FilterBarProps) {
  return (
    <section className={cn("space-y-3", sectionClassName)} aria-label={ariaLabel}>
      <div className="relative w-full max-w-xl">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary"
          aria-hidden
        />
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className={searchClassName}
          aria-label={searchAriaLabel}
        />
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink">
            <SlidersHorizontal className="size-4 text-primary" aria-hidden />
            <span className="text-[13px] font-medium">{title}</span>
            {active ? (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                Active
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={!active}
            className="h-8 shrink-0 gap-1.5 border-hairline bg-white px-3 text-ink hover:border-primary/30 hover:bg-primary-tint-2 hover:text-primary disabled:opacity-40"
          >
            <RotateCcw className="size-3.5 text-primary" />
            {resetLabel}
          </Button>
        </div>

        <div className={cn("grid grid-cols-1 gap-3", gridClassName)}>{children}</div>
      </div>
    </section>
  );
}
