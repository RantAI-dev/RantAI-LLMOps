"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FilterSegment = {
  value: string;
  label: string;
  count?: number;
};

type FilterToolbarProps = {
  /** Left-side filter controls (FilterDropdowns, segment groups, etc.). */
  children?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  /** Hide the right-side search field (e.g. when a child panel owns search). */
  showSearch?: boolean;
  /** Control(s) rendered immediately beside search (e.g. Sort). */
  searchAside?: ReactNode;
  /** Optional segmented pills (All / Downloaded / …). */
  segments?: FilterSegment[];
  segmentValue?: string;
  onSegmentChange?: (value: string) => void;
  className?: string;
};

/**
 * Horizontal Arto-style filter row: filters/segments on the left, search (+ optional
 * aside like Sort) on the right. Shared across Hub and list pages.
 */
export function FilterToolbar({
  children,
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search",
  searchAriaLabel = "Search",
  showSearch = true,
  searchAside,
  segments,
  segmentValue,
  onSegmentChange,
  className,
}: FilterToolbarProps) {
  const showSearchField = showSearch && Boolean(onSearchChange);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
        className
      )}
      role="search"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {segments && onSegmentChange ? (
          <div
            className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5"
            role="tablist"
            aria-label="Status filter"
          >
            {segments.map((segment) => {
              const active = segment.value === segmentValue;
              return (
                <button
                  key={segment.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSegmentChange(segment.value)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
                    active
                      ? "bg-background font-medium text-ink shadow-sm"
                      : "font-medium text-ink-soft hover:text-ink"
                  )}
                >
                  <span>{segment.label}</span>
                  {typeof segment.count === "number" ? (
                    <span className={cn("font-normal", active ? "text-ink-soft" : "text-ink-faint")}>
                      {segment.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {children}
      </div>

      {showSearchField || searchAside ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {searchAside}
          {showSearchField ? (
            <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
                aria-hidden
              />
              <Input
                value={searchValue}
                onChange={(event) => onSearchChange?.(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchAriaLabel}
                className="h-9 rounded-lg border-border bg-background pl-9 shadow-sm"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
