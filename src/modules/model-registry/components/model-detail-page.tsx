"use client";

import { useParams, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { DeleteModelDialog } from "@/modules/model-registry/components/delete-model-dialog";
import { ModelDetailView } from "@/modules/model-registry/components/model-detail-view";
import { useModelRegistry } from "@/modules/model-registry/hooks/use-model-registry";
import { baseSearchQuery } from "@/modules/model-registry/lib/utils";

/**
 * Route-level model detail (`/models/[...id]`). Deep-linkable — Back/refresh work.
 * Reads from the shared ModelRegistryProvider (mounted in the app layout). The
 * catch-all `id` segments are rejoined because model ids can contain "/" or ":".
 */
export function ModelDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  // Ids can carry ":" (Ollama tags like "…:latest") which arrives percent-encoded
  // in the URL — decode each segment so the lookup matches the catalog id.
  const rawId = Array.isArray(params.id) ? params.id.join("/") : (params.id ?? "");
  const id = rawId
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");

  const { models, modelsLoading, deleteTargetId, setDeleteTargetId, deleteModel } =
    useModelRegistry();
  const stripLatest = (s: string) => s.replace(/:latest$/, "");
  const model =
    models.find((m) => m.id === id || m.id === rawId) ??
    models.find((m) => stripLatest(m.id) === stripLatest(id)) ??
    null;
  const deleteTarget = deleteTargetId ? models.find((m) => m.id === deleteTargetId) ?? null : null;
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
        onTest={() => router.push(`/interact?model=${encodeURIComponent(model.id)}`)}
        onFineTune={() =>
          router.push(`/finetune?base=${encodeURIComponent(baseSearchQuery(model.id))}`)
        }
        onCompare={() =>
          router.push(
            model.id.startsWith("nqr-")
              ? `/generations?ft=${encodeURIComponent(model.id)}`
              : `/generations?base=${encodeURIComponent(model.id)}`
          )
        }
        onDelete={() => setDeleteTargetId(model.id)}
      />
      <DeleteModelDialog
        model={deleteTarget}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          if (!deleteTargetId) return;
          await deleteModel(deleteTargetId);
          back();
        }}
      />
    </>
  );
}
