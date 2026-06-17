import { StatusBadge } from "@/components/ui/status-badge";
import { statusStyles } from "@/modules/tasks/lib/utils";
import type { TaskStatus } from "@/modules/tasks/types";

type TaskStatusBadgeProps = {
  status: TaskStatus;
  className?: string;
};

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  return <StatusBadge status={status} style={statusStyles[status]} className={className} />;
}
