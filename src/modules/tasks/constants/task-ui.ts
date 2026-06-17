import { textUi } from "@/lib/text-ui";

export const taskUi = textUi;

/** Figma Input field (node 5:6096) — shared search & filter controls */
export const fieldClassName =
  "h-8 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 text-sm leading-5 text-ink shadow-none outline-none transition-[color,box-shadow] placeholder:text-ink/60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";

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
