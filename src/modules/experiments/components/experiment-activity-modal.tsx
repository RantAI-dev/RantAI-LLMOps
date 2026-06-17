"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/modules/experiments/lib/utils";
import type { Experiment } from "@/modules/experiments/types";

type ExperimentActivityModalProps = {
  open: boolean;
  experiment: Experiment;
  onClose: () => void;
};

export function ExperimentActivityModal({ open, experiment, onClose }: ExperimentActivityModalProps) {
  const items = experiment.activityHistory;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[min(80vh,640px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-base text-primary">Activity history</DialogTitle>
          <DialogDescription>{experiment.name}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-ink-soft">No activity recorded yet.</p>
          ) : (
            <ul>
              {items.map((item, index) => (
                <li key={item.id} className="flex gap-3 border-b border-surface-3 py-2.5 last:border-0">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-5 text-ink">{item.message}</p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">{formatDateTime(item.createdAt)}</p>
                  </div>
                  {index === 0 ? (
                    <span className="shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      Latest
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t border-border px-4 py-2.5">
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
