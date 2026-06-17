"use client";

import { Check } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type DatasetWizardStepperProps = {
  steps: readonly string[];
  currentStep: number;
};

export function DatasetWizardStepper({ steps, currentStep }: DatasetWizardStepperProps) {
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className="border-b border-hairline bg-surface px-5 py-4">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
        <span className="text-ink-soft">
          Step {currentStep + 1} of {steps.length}
        </span>
        <span className="font-medium text-primary">{steps[currentStep]}</span>
      </div>
      <Progress value={progress} className="h-1" />
      <ol className="mt-4 hidden gap-0 sm:flex" aria-label="Wizard progress">
        {steps.map((label, index) => {
          const done = index < currentStep;
          const active = index === currentStep;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors",
                    done && "bg-primary text-white",
                    active && "border-2 border-primary bg-white text-primary",
                    !done && !active && "border border-hairline bg-white text-ink-faint"
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
                </span>
                <span
                  className={cn(
                    "hidden truncate text-[11px] font-medium lg:inline",
                    active ? "text-primary" : done ? "text-ink" : "text-ink-faint"
                  )}
                >
                  {label}
                </span>
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={cn(
                    "mx-2 h-px min-w-[12px] flex-1",
                    done ? "bg-primary/40" : "bg-hairline"
                  )}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
