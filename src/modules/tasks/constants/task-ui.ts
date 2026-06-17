export const taskUi = {
  body: "text-[14px] leading-5",
  title: "text-2xl font-semibold leading-8 tracking-tight",
  subheading: "text-base leading-6 text-ink-soft",
  section: "text-lg font-semibold leading-7 tracking-tight",
  metric: "text-2xl font-semibold leading-8 tabular-nums tracking-tight",
  label: "text-[12px] font-medium text-ink-soft",
} as const;

/** Figma Input field (node 5:6096) — shared search & filter controls */
export const fieldClassName =
  "h-8 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 text-[14px] leading-5 text-ink shadow-none outline-none transition-[color,box-shadow] placeholder:text-ink/60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";

export const searchFieldClassName = cnField(
  "pl-9"
);

export const filterSelectClassName = cnField(
  "cursor-pointer appearance-none pr-8 font-medium text-ink"
);

function cnField(extra: string) {
  return `${fieldClassName} ${extra}`;
}

// Legacy export — prefer filterSelectClassName
export const selectClassName = filterSelectClassName;
