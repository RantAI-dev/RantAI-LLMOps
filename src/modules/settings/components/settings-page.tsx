import { KeyRound, Palette } from "lucide-react";

import { ThemePreference } from "@/components/theme-toggle";
import { InfoTip } from "@/components/ui/tooltip";
import { HfTokenField } from "@/modules/settings/components/hf-token-field";

/** App-wide settings — credentials and preferences shared across the whole
 *  LLMOps workspace (not per-feature). */
export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div className="flex items-center gap-1.5">
        <h1 className="text-lg font-semibold text-primary">Settings</h1>
        <InfoTip label="About settings">
          These apply across the entire workspace — save once and they are used everywhere
          (fine-tune, Hub, and downloads).
        </InfoTip>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <Palette className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Appearance</h2>
        </div>
        <p className="mb-3 text-[13px] text-ink-soft">
          Choose Light, Dark, or follow your system preference.
        </p>
        <ThemePreference />
      </section>

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
