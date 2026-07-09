import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/modules/auth";
import { DatasetsProvider } from "@/modules/datasets";
import { LlmOpsProvider } from "@/modules/llm-ops/context/llm-ops-provider";
import { ModelRegistryProvider } from "@/modules/model-registry";

/**
 * Authenticated app shell. Access is enforced by the server-side shared-password
 * gate (proxy.ts middleware -> /login with APP_PASSWORD), so there is a single
 * login. AuthProvider only exposes the signed-in identity + logout to the shell.
 *
 * App Router keeps this layout mounted while navigating between sibling routes,
 * so the in-memory mock providers (and their state) persist across menu changes.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LlmOpsProvider>
        <DatasetsProvider>
          <ModelRegistryProvider>
            <AppShell>{children}</AppShell>
          </ModelRegistryProvider>
        </DatasetsProvider>
      </LlmOpsProvider>
    </AuthProvider>
  );
}
