import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const surfaceVariants = cva("rounded-lg border", {
  variants: {
    tone: {
      default: "border-border bg-card text-card-foreground",
      muted: "border-border bg-muted/50 text-foreground",
      outline: "border-border bg-background text-foreground",
    },
    spacing: {
      none: "p-0",
      sm: "p-4",
      md: "p-6",
      lg: "p-8",
    },
  },
  defaultVariants: {
    tone: "default",
    spacing: "md",
  },
});

type SurfaceProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof surfaceVariants>;

export function Surface({ className, tone, spacing, ...props }: SurfaceProps) {
  return (
    <div
      data-slot="surface"
      className={cn(surfaceVariants({ tone, spacing }), className)}
      {...props}
    />
  );
}

export { surfaceVariants };
