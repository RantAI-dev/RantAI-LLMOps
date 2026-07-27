"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export type FilterDropdownOption = {
  value: string;
  label: string;
  /** Secondary muted text (e.g. code / short hint). */
  hint?: string;
  icon?: ReactNode;
};

type FilterDropdownProps = {
  /** Button label when showing the filter category (or current value). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterDropdownOption[];
  /** Prefer showing the selected option label on the trigger. Default true. */
  showSelectedLabel?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  align?: "start" | "end";
};

/**
 * Arto-style filter pill + searchable dropdown (Currency-like). Shared across
 * Hub and list pages via FilterToolbar.
 */
export function FilterDropdown({
  label,
  value,
  onChange,
  options,
  showSelectedLabel = true,
  searchable = true,
  searchPlaceholder = "Type to search…",
  className,
  align = "start",
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value);
  const triggerLabel =
    showSelectedLabel && selected ? selected.label : label;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        option.hint?.toLowerCase().includes(q) ||
        option.value.toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open, searchable]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-medium text-ink shadow-sm transition-colors",
          open
            ? "border-info/40 bg-info-soft text-ink"
            : "border-border hover:bg-surface-2"
        )}
      >
        <span className="max-w-[10rem] truncate">{triggerLabel}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-colors",
            open ? "text-info" : "text-ink-faint"
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          className={cn(
            "absolute top-[calc(100%+10px)] z-50 w-[min(18.5rem,calc(100vw-2rem))] rounded-xl border border-border/60 bg-background shadow-xl",
            align === "end" ? "right-0" : "left-0"
          )}
          role="presentation"
        >
          {/* Caret pointing at the trigger */}
          <span
            className={cn(
              "pointer-events-none absolute -top-1.5 size-3 rotate-45 border-t border-l border-border/60 bg-background",
              align === "end" ? "right-6" : "left-6"
            )}
            aria-hidden
          />

          {searchable ? (
            <div className="relative border-b border-hairline px-3 py-2.5">
              <Search
                className="pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-ink-faint"
                aria-hidden
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-full bg-transparent pl-7 text-sm text-ink outline-none placeholder:text-ink-faint"
                aria-label={searchPlaceholder}
              />
            </div>
          ) : null}

          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-64 overflow-y-auto py-1.5"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-ink-soft">Tidak ada hasil</li>
            ) : (
              filtered.map((option) => {
                const active = option.value === value;
                return (
                  <li key={option.value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        active ? "bg-surface-2" : "hover:bg-surface-2"
                      )}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      {option.icon ? (
                        <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-[11px]">
                          {option.icon}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink">{option.label}</span>
                        {option.hint ? (
                          <span className="ml-1.5 font-normal text-ink-faint">{option.hint}</span>
                        ) : null}
                      </span>
                      {active ? (
                        <Check className="size-3.5 shrink-0 text-info" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
