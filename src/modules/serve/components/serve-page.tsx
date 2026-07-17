"use client";

import { GatewayAccess } from "@/modules/serve/components/gateway-access";

/**
 * Deployments page. Ollama serves every pulled model automatically, so there is no
 * per-model "deploy into VRAM" step to manage here — external access is governed
 * entirely by the gateway (which models are exposed + which API keys may call it),
 * managed via <GatewayAccess>. The older named-serve-config bookkeeping was removed
 * to avoid two competing notions of "deploy".
 */
export function ServePage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Deployments</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Atur akses klien eksternal (mis. RantAI Agents) ke model-mu: pilih model yang diekspos +
          kelola API key. Semua lewat gateway ber-API-key — Ollama sendiri tetap tertutup dari jaringan.
        </p>
      </div>

      <GatewayAccess />
    </div>
  );
}
