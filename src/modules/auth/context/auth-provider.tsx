"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

/**
 * Lightweight auth context.
 *
 * The real access gate is the server-side shared-password middleware
 * (`proxy.ts` -> `/login` with `APP_PASSWORD`). By the time this provider
 * mounts, the request already passed that gate, so we simply expose a signed-in
 * identity + a `logout` that clears the cookie and returns to `/login`.
 */
type CurrentUser = { name: string; email: string };

type AuthContextValue = {
  user: CurrentUser;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      window.location.href = "/login";
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user: { name: "Admin", email: "" }, logout }),
    [logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
