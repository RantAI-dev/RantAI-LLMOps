import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

function Input({ className, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 text-[14px] leading-5 text-ink shadow-none transition-[color,box-shadow] outline-none placeholder:text-ink/60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };
