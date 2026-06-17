import { StatusBadge } from "@/components/ui/status-badge";
import { statusStyles } from "@/modules/experiments/lib/utils";
import type { ExperimentStatus } from "@/modules/experiments/types";

export function ExperimentStatusBadge({
  status,
  className,
}: {
  status: ExperimentStatus;
  className?: string;
}) {
  return <StatusBadge status={status} style={statusStyles[status]} className={className} />;
}
