"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/modules/auth/context/auth-provider";
import { LoginScreen } from "./login-screen";

/** Renders the login screen until the user is authenticated. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-surface">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return <LoginScreen />;

  return <>{children}</>;
}
