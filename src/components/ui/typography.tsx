import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "@/lib/utils";

const typographyVariants = cva("text-foreground", {
  variants: {
    variant: {
      h1: "font-heading text-2xl font-semibold leading-8 tracking-tight",
      h2: "font-heading text-xl font-semibold leading-7 tracking-tight",
      h3: "font-heading text-lg font-semibold leading-7",
      body: "text-sm leading-5",
      bodySmall: "text-sm leading-5 text-muted-foreground",
      label: "text-sm font-medium leading-5",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

type TypographyElement = "h1" | "h2" | "h3" | "p" | "span" | "label";

type TypographyProps<C extends ElementType> = {
  as?: C;
  className?: string;
} & VariantProps<typeof typographyVariants> &
  Omit<ComponentPropsWithoutRef<C>, "as" | "className">;

export function Typography<C extends TypographyElement = "p">({
  as,
  className,
  variant,
  ...props
}: TypographyProps<C>) {
  const Component = (as ?? "p") as ElementType;

  return (
    <Component className={cn(typographyVariants({ variant }), className)} {...props} />
  );
}

export { typographyVariants };
