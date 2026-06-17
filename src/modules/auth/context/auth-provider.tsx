"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  type CurrentUser,
  fetchCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  nameFromEmail,
} from "@/lib/api/auth";
import { USE_REAL_API } from "@/lib/api/config";
import { getToken, getUserEmail, setUserEmail } from "@/lib/api/session";

type AuthContextValue = {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore an existing session on mount (client-only — reads localStorage).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (!token) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      if (USE_REAL_API) {
        try {
          const me = await fetchCurrentUser();
          if (!cancelled) setUser(me);
        } catch {
          apiLogout();
        }
      } else {
        const email = getUserEmail() ?? "admin@example.com";
        if (!cancelled) setUser({ email, name: nameFromEmail(email) });
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password);
    if (USE_REAL_API) {
      setUser(await fetchCurrentUser());
    } else {
      setUserEmail(email);
      setUser({ email, name: nameFromEmail(email) });
    }
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
    }),
    [user, isLoading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
