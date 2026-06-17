"use client";

import {
  CheckCircle2,
  ExternalLink,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { BreadcrumbNav } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { MockBanner } from "@/components/ui/mock-banner";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ModelCompatibilityBadge,
  ModelProviderBadge,
  ModelStatusBadge,
} from "@/modules/model-registry/components/model-badges";
import { ModelDetailToolbar } from "@/modules/model-registry/components/model-detail-toolbar";
import {
  DETAIL_TABS,
  modelRegistryUi,
  panelClassName,
} from "@/modules/model-registry/constants/model-registry-ui";
import { formatDateTime, formatNumber } from "@/modules/model-registry/lib/utils";
import type { RegistryModel } from "@/modules/model-registry/types";
import { cn } from "@/lib/utils";

type ModelDetailViewProps = {
  model: RegistryModel;
  onBack: () => void;
  onTest: () => void;
  onDeploy: (environment: "Staging" | "Production") => void;
  onFineTune: () => void;
  onCompare: () => void;
  onArchive: () => void;
  onStopDeployment: () => void;
  onRunEvaluation: () => void;
};

export function ModelDetailView({
  model,
  onBack,
  onTest,
  onDeploy,
  onFineTune,
  onCompare,
  onArchive,
  onStopDeployment,
  onRunEvaluation,
}: ModelDetailViewProps) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <article className="min-w-0 w-full space-y-3">
      <header className="space-y-2 border-b border-border pb-3">
        <BreadcrumbNav items={[{ label: "Model Registry", onClick: onBack }, { label: model.modelName }]} />
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={modelRegistryUi.detailTitle}>{model.modelName}</h1>
              <ModelProviderBadge provider={model.provider} />
              <ModelStatusBadge status={model.status} />
              <ModelCompatibilityBadge status={model.compatibilityStatus} />
            </div>
            {model.repoId ? (
              <p className="mt-1 text-xs text-ink-soft">{model.repoId}</p>
            ) : null}
          </div>
          <ModelDetailToolbar
            model={model}
            onTest={onTest}
            onDeploy={() => onDeploy("Staging")}
            onFineTune={onFineTune}
            onCompare={onCompare}
            onArchive={onArchive}
          />
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-[#ffe7d8] p-1">
          {DETAIL_TABS.filter((tab) => tab.id !== "huggingface" || model.provider === "Hugging Face").map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-3">
          <OverviewTab model={model} />
        </TabsContent>

        {model.provider === "Hugging Face" && model.huggingFaceSource ? (
          <TabsContent value="huggingface" className="mt-3">
            <HuggingFaceTab model={model} />
          </TabsContent>
        ) : null}

        <TabsContent value="files" className="mt-3">
          <FilesTab model={model} />
        </TabsContent>

        <TabsContent value="compatibility" className="mt-3">
          <CompatibilityTab model={model} />
        </TabsContent>

        <TabsContent value="deployment" className="mt-3">
          <DeploymentTab model={model} onDeploy={onDeploy} onStopDeployment={onStopDeployment} />
        </TabsContent>

        <TabsContent value="evaluation" className="mt-3">
          <EvaluationTab model={model} onRunEvaluation={onRunEvaluation} />
        </TabsContent>

        <TabsContent value="usage" className="mt-3">
          <UsageTab model={model} />
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <AuditTab model={model} />
        </TabsContent>
      </Tabs>
    </article>
  );
}

function OverviewTab({ model }: { model: RegistryModel }) {
  return (
    <div className={cn(panelClassName, "p-4")}>
      <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
        <Meta label="Model Name" value={model.modelName} />
        <Meta label="Internal Model ID" value={model.id} />
        <Meta label="Provider" value={model.provider} />
        <Meta label="Repo ID" value={model.repoId ?? "—"} />
        <Meta label="Author" value={model.author} />
        <Meta label="Task / Pipeline" value={model.task} />
        <Meta label="Library" value={model.libraryName} />
        <Meta label="Format" value={model.modelFormat} />
        <Meta label="Parameter Size" value={model.parameterSize} />
        <Meta label="Context Length" value={String(model.contextLength)} />
        <Meta label="License" value={model.license} />
        <Meta label="Language" value={model.language.join(", ")} />
        <Meta label="Owner" value={model.owner} />
        <Meta label="Status" value={model.status} />
        <Meta label="Created At" value={formatDateTime(model.createdAt)} />
        <Meta label="Updated At" value={formatDateTime(model.updatedAt)} />
      </dl>
      {model.tags.length > 0 ? (
        <div className="mt-4">
          <p className={modelRegistryUi.label}>Tags</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {model.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-strong">{tag}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HuggingFaceTab({ model }: { model: RegistryModel }) {
  const hf = model.huggingFaceSource!;
  return (
    <div className={cn(panelClassName, "space-y-4 p-4")}>
      <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
        <Meta label="Repo ID" value={hf.repoId} />
        <Meta label="Repo URL" value={hf.repoUrl} />
        <Meta label="Author / Organization" value={hf.author} />
        <Meta label="Branch / Revision" value={hf.branch} />
        <Meta label="Commit SHA" value={hf.commitSha} />
        <Meta label="Downloads" value={formatNumber(hf.downloads)} />
        <Meta label="Likes" value={formatNumber(hf.likes)} />
        <Meta label="Last Modified" value={formatDateTime(hf.lastModified)} />
        <Meta label="Base Model" value={hf.baseModel ?? "—"} />
        <Meta label="Dataset Used" value={hf.datasetUsed ?? "—"} />
        <Meta label="Access Type" value={hf.accessType} />
        <Meta label="Import Mode" value={hf.importMode} />
      </dl>
      <div>
        <p className={modelRegistryUi.label}>Model Card Summary</p>
        <p className="mt-1 text-[13px] text-ink">{hf.modelCardSummary}</p>
      </div>
      <a href={hf.repoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline">
        Open on Hugging Face <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function FilesTab({ model }: { model: RegistryModel }) {
  if (model.files.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        No files registered. Import with Full Download to fetch model files.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-white">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>File Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Download Status</TableHead>
            <TableHead>Storage Location</TableHead>
            <TableHead>Checksum</TableHead>
            <TableHead>Downloaded At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.files.map((file) => (
            <TableRow key={file.id}>
              <TableCell className="font-medium text-ink">{file.fileName}</TableCell>
              <TableCell>{file.fileType}</TableCell>
              <TableCell className="tabular-nums">{file.fileSize}</TableCell>
              <TableCell>{file.isRequired ? "Yes" : "No"}</TableCell>
              <TableCell>{file.downloadStatus}</TableCell>
              <TableCell className="text-xs text-ink-soft">{file.storageLocation}</TableCell>
              <TableCell className="font-mono text-[11px]">{file.checksum}</TableCell>
              <TableCell>{formatDateTime(file.downloadedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CompatibilityTab({ model }: { model: RegistryModel }) {
  const checklist = model.compatibilityChecklist;
  const items = [
    { key: "accessValid", label: "Access valid" },
    { key: "licenseReviewed", label: "License reviewed" },
    { key: "configAvailable", label: "Config available" },
    { key: "tokenizerAvailable", label: "Tokenizer available" },
    { key: "modelFilesAvailable", label: "Model files available" },
    { key: "vllmSupported", label: "vLLM supported" },
    { key: "hardwareChecked", label: "Hardware requirement checked" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className={cn(panelClassName, "p-4")}>
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Meta label="vLLM Compatible" value={model.vllmCompatible} />
          <Meta label="Transformers Compatible" value={model.transformersCompatible} />
          <Meta label="Requires trust_remote_code" value={model.requiresTrustRemoteCode ? "Yes" : "No"} />
          <Meta label="Quantization" value={model.quantization ?? "None"} />
          <Meta label="Supports Streaming" value={model.supportsStreaming ? "Yes" : "No"} />
          <Meta label="Supports Chat Template" value={model.supportsChatTemplate ? "Yes" : "No"} />
          <Meta label="Tokenizer Available" value={checklist.tokenizerAvailable ? "Yes" : "No"} />
          <Meta label="Config Available" value={checklist.configAvailable ? "Yes" : "No"} />
          <Meta label="Recommended Serving Engine" value={model.deployment.servingEngine} />
          <Meta label="Min VRAM Required" value={model.minVramRequired} />
          <Meta label="Recommended GPU" value={model.recommendedGpu} />
          <Meta label="GPU Count Required" value={String(model.gpuCountRequired)} />
          <Meta label="Deployment Readiness" value={model.deploymentReadiness} />
        </dl>
      </div>
      <div className={cn(panelClassName, "p-4")}>
        <h4 className="text-[13px] font-semibold text-ink">Readiness checklist</h4>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map(({ key, label }) => {
            const ok = checklist[key];
            return (
              <li key={key} className="flex items-center gap-2 text-[13px]">
                {ok ? (
                  <CheckCircle2 className="size-4 text-success-solid" />
                ) : (
                  <XCircle className="size-4 text-danger-solid" />
                )}
                <span className={ok ? "text-ink" : "text-ink-soft"}>{label}</span>
              </li>
            );
          })}
        </ul>
        {model.deploymentReadiness === "Ready" ? (
          <p className="mt-3 text-[13px] text-success">Model is ready to deploy with vLLM.</p>
        ) : model.license === "Custom" ? (
          <p className="mt-3 text-[13px] text-warning">License needs review before production deployment.</p>
        ) : null}
      </div>
    </div>
  );
}

function DeploymentTab({
  model,
  onDeploy,
  onStopDeployment,
}: {
  model: RegistryModel;
  onDeploy: (env: "Staging" | "Production") => void;
  onStopDeployment: () => void;
}) {
  const d = model.deployment;
  return (
    <div className="space-y-4">
      <MockBanner>
        Transformer Lab tidak punya orkestrasi serving — tidak ada Deploy ke Staging/Production,
        endpoint URL, replica, atau rollback. Inference di TL = jalankan job (vLLM/Ollama) lalu ambil
        URL tunnel-nya. Data di bawah masih contoh (mock).
      </MockBanner>
      <div className={cn(panelClassName, "p-4")}>
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Meta label="Environment" value={d.environment} />
          <Meta label="Serving Engine" value={d.servingEngine} />
          <Meta label="Endpoint URL" value={d.endpointUrl || "—"} />
          <Meta label="GPU Cluster" value={d.gpuCluster || "—"} />
          <Meta label="Replica" value={String(d.replica)} />
          <Meta label="Status" value={d.status} />
          <Meta label="Last Deployment" value={formatDateTime(d.lastDeployment)} />
          <Meta label="Rollback Version" value={d.rollbackVersion ?? "—"} />
        </dl>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onDeploy("Staging")}>Deploy to Staging</Button>
        <Button type="button" size="sm" onClick={() => onDeploy("Production")}>Deploy to Production</Button>
        {d.status === "Running" ? (
          <Button type="button" variant="outline" size="sm" onClick={onStopDeployment}>Stop Deployment</Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" disabled>View Logs</Button>
      </div>
      <p className="text-xs text-ink-soft">Test this model in Playground before deploying to production.</p>
    </div>
  );
}

function EvaluationTab({ model, onRunEvaluation }: { model: RegistryModel; onRunEvaluation: () => void }) {
  const e = model.evaluation;
  return (
    <div className="space-y-4">
      <MockBanner>
        Skor model terstruktur (accuracy/hallucination/safety/latency/cost) belum tersedia dari TL —
        eval di TL berbasis artifact (CSV/JSON) hasil job. Angka di bawah masih contoh (mock).
      </MockBanner>
      <div className={cn(panelClassName, "p-4")}>
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Meta label="Evaluation Dataset" value={e.evaluationDataset} />
          <Meta label="Accuracy" value={e.accuracy ? `${e.accuracy.toFixed(1)}%` : "—"} />
          <Meta label="Hallucination Rate" value={e.hallucinationRate ? `${e.hallucinationRate.toFixed(1)}%` : "—"} />
          <Meta label="Safety Score" value={e.safetyScore ? `${e.safetyScore.toFixed(1)}%` : "—"} />
          <Meta label="Latency" value={e.latencyMs ? `${e.latencyMs} ms` : "—"} />
          <Meta label="Cost Estimate" value={e.costEstimate} />
          <Meta label="Last Evaluation Run" value={formatDateTime(e.lastEvaluationRun)} />
        </dl>
      </div>
      <Button type="button" onClick={onRunEvaluation}>Run Evaluation</Button>
    </div>
  );
}

function UsageTab({ model }: { model: RegistryModel }) {
  const u = model.usage;
  return (
    <div className="space-y-4">
      <MockBanner>
        TL tidak melacak traffic serving per model (requests, latency, token, GPU utilization) karena
        bukan TL yang menjalankan endpoint. Semua metrik di bawah masih contoh (mock).
      </MockBanner>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Requests" value={formatNumber(u.totalRequests)} />
        <MetricCard label="Success Rate" value={`${u.successRate.toFixed(1)}%`} />
        <MetricCard label="Error Rate" value={`${u.errorRate.toFixed(1)}%`} />
        <MetricCard label="Avg Latency" value={`${u.averageLatencyMs} ms`} />
        <MetricCard label="Token Usage" value={formatNumber(u.tokenUsage)} />
        <MetricCard label="Estimated Cost" value={u.estimatedCost} />
        <MetricCard label="GPU Utilization" value={`${u.gpuUtilization.toFixed(1)}%`} />
        <MetricCard label="Active Endpoint" value={u.activeEndpoint ? "Active" : "None"} />
      </div>
      <div className={cn(panelClassName, "p-4")}>
        <p className={modelRegistryUi.label}>Last 24h Usage</p>
        <div className="mt-3 flex h-32 items-end gap-1">
          {Array.from({ length: 24 }, (_, i) => {
            const height = 20 + Math.sin(i * 0.5) * 30 + (u.totalRequests > 0 ? 30 : 5);
            return (
              <div
                key={`hour-${i}`}
                className="flex-1 rounded-t bg-primary/60"
                style={{ height: `${Math.min(height, 100)}%` }}
                title={`Hour ${i}`}
              />
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-soft">Usage chart placeholder — connect monitoring backend for live data.</p>
      </div>
      {u.gpuUtilization > 0 ? (
        <div>
          <div className="mb-1 flex justify-between text-[13px] text-ink-soft">
            <span>GPU Utilization</span>
            <span>{u.gpuUtilization.toFixed(1)}%</span>
          </div>
          <Progress value={u.gpuUtilization} />
        </div>
      ) : null}
    </div>
  );
}

function AuditTab({ model }: { model: RegistryModel }) {
  const statusColors = {
    Success: "text-success bg-success-soft",
    Warning: "text-warning bg-warning-soft-2",
    Failed: "text-danger bg-danger-soft",
    Info: "text-info-strong bg-info-soft",
  };

  return (
    <div className="space-y-3">
      {model.auditLogs.map((log) => (
        <div key={log.id} className={cn(panelClassName, "flex gap-3 p-3")}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold text-ink">{log.action}</p>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusColors[log.status])}>
                {log.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-soft">{log.notes}</p>
            <p className="mt-1 text-[11px] text-ink-faint">{log.actor} · {formatDateTime(log.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(panelClassName, "p-3")}>
      <p className={modelRegistryUi.label}>{label}</p>
      <p className={cn("mt-1 text-primary", modelRegistryUi.metric)}>{value}</p>
    </div>
  );
}
