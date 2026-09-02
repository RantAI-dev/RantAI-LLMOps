"use client";

import { InfoTip } from "@/components/ui/tooltip";
import { AdapterManager } from "@/modules/serve/components/adapter-manager";
import { EngineStatus } from "@/modules/serve/components/engine-status";
import { GatewayAccess } from "@/modules/serve/components/gateway-access";
import { VllmDeploy } from "@/modules/serve/components/vllm-deploy";

/**
 * Deployments page. Ollama serves every pulled model automatically, so there is no
 * per-model "deploy into VRAM" step to manage here — external access is governed
 * entirely by the gateway (which models are exposed + which API keys may call it),
 * managed via <GatewayAccess>. The older named-serve-config bookkeeping was removed
 * to avoid two competing notions of "deploy".
 */
export function ServePage() {
  // "Deploy vLLM" is gated off by default: on GB10 the provider path (pip vLLM)
  // has no working build and the container path needs the Docker socket, so the
  // card is non-functional there. Set NEXT_PUBLIC_ENABLE_DEPLOY_VLLM=true to show
  // it where a working launcher exists.
  const showDeployVllm = process.env.NEXT_PUBLIC_ENABLE_DEPLOY_VLLM === "true";
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-center gap-1.5">
        <h1 className="text-xl font-semibold text-ink">Deployments</h1>
        <InfoTip label="About deployments">
          Manage external client access to your models (e.g. RantAI Agents): choose which models are
          exposed and manage API keys. Everything goes through the API-key gateway — Ollama itself stays
          closed to the network.
        </InfoTip>
      </div>

      <EngineStatus />
      {showDeployVllm && <VllmDeploy />}
      <AdapterManager />
      <GatewayAccess />
    </div>
  );
}
