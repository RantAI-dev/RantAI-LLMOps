import { AppShell } from "@/components/layout/app-shell";
import { AuthGate, AuthProvider } from "@/modules/auth";
import { DatasetsProvider } from "@/modules/datasets";
import { ActiveExperimentProvider } from "@/modules/experiments/context/active-experiment";
import { LlmOpsProvider } from "@/modules/llm-ops/context/llm-ops-provider";
import { ModelRegistryProvider } from "@/modules/model-registry";

/**
 * Authenticated app shell. App Router keeps this layout mounted while
 * navigating between sibling routes, so the in-memory mock providers (and
 * their state) persist across menu changes — same UX as the old SPA switch.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <LlmOpsProvider>
          <DatasetsProvider>
            <ModelRegistryProvider>
              <ActiveExperimentProvider>
                <AppShell>{children}</AppShell>
              </ActiveExperimentProvider>
            </ModelRegistryProvider>
          </DatasetsProvider>
        </LlmOpsProvider>
      </AuthGate>
    </AuthProvider>
  );
}
