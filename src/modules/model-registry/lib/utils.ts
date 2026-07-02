import { APP_TIME_ZONE, parseTlDate } from "@/lib/tl-datetime";
import type {
  CompatibilityStatus,
  ModelStatus,
  RegistryModel,
} from "@/modules/model-registry/types";

let idCounter = 100;

export function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function formatDateTime(iso: string | null): string {
  const d = parseTlDate(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(d);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatRelativeTime(iso: string): string {
  const d = parseTlDate(iso);
  if (!d) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today"; // guard future/invalid → no "-1 days ago"
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDateTime(iso);
}

export const statusStyles: Record<
  ModelStatus,
  { bg: string; text: string; dot: string }
> = {
  Draft: { bg: "bg-surface-2", text: "text-ink-strong", dot: "bg-ink-faint" },
  Available: { bg: "bg-success-soft", text: "text-success", dot: "bg-success-solid" },
  Testing: { bg: "bg-info-soft", text: "text-info-strong", dot: "bg-info-solid" },
  Production: { bg: "bg-warning-soft", text: "text-warning", dot: "bg-warning-solid" },
  "Need Review": { bg: "bg-warning-soft-2", text: "text-warning", dot: "bg-warning-solid" },
  "Need Access": { bg: "bg-pink-soft", text: "text-pink", dot: "bg-pink-solid" },
  Failed: { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger-solid" },
  Archived: { bg: "bg-surface-2", text: "text-ink-faint-strong", dot: "bg-ink-faint" },
};

export const accessStyles: Record<string, { bg: string; text: string }> = {
  Public: { bg: "bg-success-soft", text: "text-success" },
  Private: { bg: "bg-purple-soft", text: "text-purple" },
  Gated: { bg: "bg-warning-soft-2", text: "text-warning" },
};

export const compatibilityStyles: Record<CompatibilityStatus, { bg: string; text: string }> = {
  "vLLM Compatible": { bg: "bg-success-soft", text: "text-success" },
  "Transformers Compatible": { bg: "bg-info-soft", text: "text-info-strong" },
  "Need Review": { bg: "bg-warning-soft-2", text: "text-warning" },
  "Not Supported": { bg: "bg-danger-soft", text: "text-danger" },
};

export const providerStyles: Record<string, { bg: string; text: string }> = {
  "Hugging Face": { bg: "bg-warning-soft", text: "text-warning" },
  Local: { bg: "bg-purple-soft", text: "text-purple" },
  OpenAI: { bg: "bg-success-soft", text: "text-success" },
  Anthropic: { bg: "bg-pink-soft", text: "text-pink" },
  Google: { bg: "bg-info-soft", text: "text-info-strong" },
  "Custom API": { bg: "bg-surface-2", text: "text-ink-strong" },
};

export function computeSummaryStats(models: RegistryModel[]) {
  const active = models.filter((m) => m.status !== "Archived");
  return {
    total: active.length,
    readyToDeploy: active.filter(
      (m) => m.deploymentReadiness === "Ready" && m.status === "Available"
    ).length,
    needReview: active.filter(
      (m) => m.status === "Need Review" || m.compatibilityStatus === "Need Review"
    ).length,
    inProduction: active.filter((m) => m.status === "Production").length,
  };
}

export function filterModels(
  models: RegistryModel[],
  filters: import("@/modules/model-registry/types").ModelFilters
): RegistryModel[] {
  const q = filters.search.trim().toLowerCase();
  return models
    .filter((m) => m.status !== "Archived" || filters.status === "Archived")
    .filter((m) => {
      if (filters.provider !== "all" && m.provider !== filters.provider) return false;
      if (filters.task !== "all" && m.task !== filters.task) return false;
      if (filters.status !== "all" && m.status !== filters.status) return false;
      if (filters.access !== "all" && m.accessType !== filters.access) return false;
      if (filters.compatibility !== "all") {
        if (filters.compatibility === "vLLM Compatible" && m.compatibilityStatus !== "vLLM Compatible")
          return false;
        if (filters.compatibility === "Need Review" && m.compatibilityStatus !== "Need Review")
          return false;
        if (filters.compatibility === "Not Supported" && m.compatibilityStatus !== "Not Supported")
          return false;
      }
      if (!q) return true;
      const haystack = [
        m.modelName,
        m.repoId ?? "",
        m.provider,
        m.author,
        ...m.tags,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
