import { KeyRound } from "lucide-react";

import { HfTokenField } from "@/modules/settings/components/hf-token-field";

/** App-wide settings — credentials and preferences shared across the whole
 *  LLMOps workspace (not per-feature). */
export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-primary">Settings</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Pengaturan yang berlaku untuk <strong>seluruh workspace</strong> — simpan sekali, kepakai
          di mana saja (fine-tune, Hub, download).
        </p>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Credentials</h2>
        </div>
        <HfTokenField />
      </section>
    </div>
  );
}
