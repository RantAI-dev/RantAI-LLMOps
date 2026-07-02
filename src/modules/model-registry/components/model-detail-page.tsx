"use client";

import { useParams, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { ArchiveModelDialog } from "@/modules/model-registry/components/archive-model-dialog";
import { ModelDetailView } from "@/modules/model-registry/components/model-detail-view";
import { useModelRegistry } from "@/modules/model-registry/hooks/use-model-registry";

/**
 * Route-level model detail (`/models/[...id]`). Deep-linkable — Back/refresh work.
 * Reads from the shared ModelRegistryProvider (mounted in the app layout). The
 * catch-all `id` segments are rejoined because model ids can contain "/" or ":".
 */
export function ModelDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id.join("/") : (params.id ?? "");

  const { models, modelsLoading, archiveTargetId, setArchiveTargetId, archiveModel, showToast } =
    useModelRegistry();
  const model = models.find((m) => m.id === id) ?? null;
  const archiveTarget = archiveTargetId ? models.find((m) => m.id === archiveTargetId) ?? null : null;
  const back = () => router.push("/models");

  if (!model) {
    if (modelsLoading) return <LoadingState label="Loading model…" />;
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-semibold text-primary">Model not found</h2>
        <p className="mt-2 max-w-md text-sm text-ink-soft">
          This model isn’t in the registry (or was removed).
        </p>
        <Button type="button" className="mt-6" onClick={back}>
          Back to Model Registry
        </Button>
      </div>
    );
  }

  return (
    <>
      <ModelDetailView
        model={model}
        onBack={back}
        onTest={() =>
          showToast({
            title: "Opening Playground",
            description: "Test this model in Playground before deploying to production.",
            variant: "info",
          })
        }
        onFineTune={() =>
          showToast({ title: "Fine-tune workflow", description: "Fine-tune setup will open here.", variant: "info" })
        }
        onCompare={() =>
          showToast({ title: "Compare models", description: "Model comparison view will open here.", variant: "info" })
        }
        onArchive={() => setArchiveTargetId(model.id)}
      />
      <ArchiveModelDialog
        model={archiveTarget}
        onClose={() => setArchiveTargetId(null)}
        onConfirm={() => {
          if (archiveTargetId) {
            archiveModel(archiveTargetId);
            back();
          }
        }}
      />
    </>
  );
}
