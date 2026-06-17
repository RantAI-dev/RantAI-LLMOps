import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { taskUi } from "@/modules/tasks/constants/task-ui";

type FilterSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  showLabel?: boolean;
};

/** Compact filter dropdown built on the shadcn Select primitive. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
  showLabel = false,
}: FilterSelectProps) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {showLabel ? (
        <span className={cn(taskUi.label, "normal-case")}>{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
      <Select
        items={options}
        value={value}
        onValueChange={(next) => {
          if (next != null) onChange(next);
        }}
      >
        <SelectTrigger
          aria-label={label}
          className="h-8 w-full text-[14px] font-medium text-ink"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
