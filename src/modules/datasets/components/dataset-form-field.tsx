import { cn } from "@/lib/utils";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";

export function DatasetFormField({
  label,
  required,
  helper,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className={datasetUi.label}>
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </span>
      {helper ? <p className="text-[12px] leading-4 text-ink-soft">{helper}</p> : null}
      {children}
    </label>
  );
}
