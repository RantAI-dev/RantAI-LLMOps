import { cn } from "@/lib/utils";
import { accessStyles, compatibilityStyles, providerStyles, statusStyles } from "@/modules/model-registry/lib/utils";
import type { AccessType, CompatibilityStatus, ModelProvider, ModelStatus } from "@/modules/model-registry/types";

export function ModelStatusBadge({ status, className }: { status: ModelStatus; className?: string }) {
  const style = statusStyles[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-4", style.bg, style.text, className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {status}
    </span>
  );
}

export function ModelAccessBadge({ access, className }: { access: AccessType; className?: string }) {
  const style = accessStyles[access];
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", style.bg, style.text, className)}>
      {access}
    </span>
  );
}

export function ModelCompatibilityBadge({ status, className }: { status: CompatibilityStatus; className?: string }) {
  const style = compatibilityStyles[status];
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", style.bg, style.text, className)}>
      {status}
    </span>
  );
}

export function ModelProviderBadge({ provider, className }: { provider: ModelProvider; className?: string }) {
  const style = providerStyles[provider] ?? providerStyles["Custom API"];
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", style!.bg, style!.text, className)}>
      {provider}
    </span>
  );
}
