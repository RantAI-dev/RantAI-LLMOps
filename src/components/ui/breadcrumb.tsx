import { ChevronRight } from "lucide-react";
import { Fragment, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Breadcrumb({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)} {...props} />
  );
}

function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      className={cn("flex min-w-0 flex-wrap items-center gap-1 text-[13px] leading-5", className)}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("flex min-w-0 items-center gap-1", className)} {...props} />;
}

function BreadcrumbLink({
  className,
  ...props
}: ComponentProps<"button"> & { asChild?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "truncate font-medium text-primary transition-colors hover:text-[#e64800] hover:underline",
        className
      )}
      {...props}
    />
  );
}

function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-current="page"
      className={cn("truncate font-semibold text-ink", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<"li">) {
  return (
    <li role="presentation" aria-hidden className={cn("flex items-center", className)} {...props}>
      {children ?? <ChevronRight className="size-3.5 shrink-0 text-ink-faint" />}
    </li>
  );
}

function BreadcrumbEllipsis({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("flex size-5 items-center justify-center text-ink-faint", className)} {...props}>
      …
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
};

export type BreadcrumbNavProps = {
  items: { label: string; onClick?: () => void }[];
  className?: string;
};

/** Convenience wrapper: last item is current page (not clickable). */
export function BreadcrumbNav({ items, className }: BreadcrumbNavProps) {
  if (items.length === 0) return null;

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage title={item.label}>{item.label}</BreadcrumbPage>
                ) : item.onClick ? (
                  <BreadcrumbLink type="button" onClick={item.onClick} title={item.label}>
                    {item.label}
                  </BreadcrumbLink>
                ) : (
                  <span className="truncate text-ink-soft">{item.label}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
