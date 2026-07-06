"use client";

import {
  Eye,
  GitCompare,
  MoreHorizontal,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ModelAccessBadge,
  ModelCompatibilityBadge,
  ModelProviderBadge,
  ModelStatusBadge,
} from "@/modules/model-registry/components/model-badges";
import { formatRelativeTime } from "@/modules/model-registry/lib/utils";
import type { RegistryModel } from "@/modules/model-registry/types";

type ModelTableProps = {
  models: RegistryModel[];
  onView: (id: string) => void;
  onTest: (id: string) => void;
  onFineTune: (id: string) => void;
  onCompare: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ModelTable({
  models,
  onView,
  onTest,
  onFineTune,
  onCompare,
  onDelete,
}: ModelTableProps) {

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table className="min-w-[1200px]">
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Model Name</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>License</TableHead>
            <TableHead>Access</TableHead>
            <TableHead>Compatibility</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
            {models.map((model) => (
              <TableRow key={model.id} className="text-[13px] hover:bg-surface/80">
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onView(model.id)}
                    className="text-left font-medium text-primary hover:underline"
                  >
                    {model.modelName}
                  </button>
                  {model.repoId ? (
                    <p className="mt-0.5 truncate text-[11px] text-ink-faint">{model.repoId}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <ModelProviderBadge provider={model.provider} />
                </TableCell>
                <TableCell className="text-ink">{model.task}</TableCell>
                <TableCell className="tabular-nums text-ink">{model.parameterSize}</TableCell>
                <TableCell className="text-ink">{model.modelFormat}</TableCell>
                <TableCell className="text-ink">{model.license}</TableCell>
                <TableCell>
                  <ModelAccessBadge access={model.accessType} />
                </TableCell>
                <TableCell>
                  <ModelCompatibilityBadge status={model.compatibilityStatus} />
                </TableCell>
                <TableCell>
                  <ModelStatusBadge status={model.status} />
                </TableCell>
                <TableCell className="text-ink-soft">{formatRelativeTime(model.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => onView(model.id)} title="View Detail">
                      <Eye className="size-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" variant="ghost" size="sm" aria-label="More actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => onTest(model.id)}>
                          <Play className="size-3.5" /> Test in Playground
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onFineTune(model.id)}>
                          <Sparkles className="size-3.5" /> Fine-tune
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onCompare(model.id)}>
                          <GitCompare className="size-3.5" /> Compare
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => onDelete(model.id)}>
                          <Trash2 className="size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
    </div>
  );
}

