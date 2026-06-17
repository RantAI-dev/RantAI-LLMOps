import { StatusBadge } from "@/components/ui/status-badge";
import { statusStyles } from "@/modules/datasets/lib/utils";
import type { ValidationStatus } from "@/modules/datasets/types";

export function DatasetStatusBadge({
  status,
  className,
}: {
  status: ValidationStatus;
  className?: string;
}) {
  return <StatusBadge status={status} style={statusStyles[status]} className={className} />;
}
