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
import { api } from "@/lib/api";
import type { LoginResult, MeResult, Organization, User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  permissions: string[];
  isSuperAdmin: boolean;
  organization: Organization | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<MeResult | null>;
  switchOrganization: (orgId: string) => Promise<void>;
  hasPermission: (code: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      api.hydrateFromStorage();
      const res = await api.get<MeResult>("/api/auth/me");
      setUser(res.data.user);
      setPermissions(res.data.permissions || []);
      setIsSuperAdmin(!!res.data.is_super_admin);
      setOrganization(res.data.current_organization);
      return res.data;
    } catch (err) {
      // Rate-limit / transient errors must not wipe a valid session
      const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) : 0;
      if (status === 429) {
        return null;
      }
      if (api.accessToken && status !== 401) {
        return null;
      }
      setUser(null);
      setPermissions([]);
      setIsSuperAdmin(false);
      setOrganization(null);
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      api.hydrateFromStorage();
      // Session via cookie refresh si pas d'access en mémoire (F5 / nouvel onglet)
      if (!api.accessToken) {
        await api.tryRefresh();
      }
      if (api.accessToken) {
        await refreshMe();
      }
      setLoading(false);
    })();
  }, [refreshMe]);

  const login = async (email: string, password: string) => {
    const res = await api.post<LoginResult>("/api/auth/login", { email, password });
    api.setAccessToken(res.data.access_token);
    const memberships = res.data.user?.memberships || [];
    if (memberships.length === 1) {
      api.setOrganizationId(memberships[0].organization_id);
    }
    setUser(res.data.user);
    setIsSuperAdmin(!!res.data.user?.is_super_admin);
    setPermissions([]);
    // Best-effort hydrate permissions; ignore rate-limit failures
    await refreshMe();
    return res.data;
  };

  const logout = async () => {
    try {
      await api.post("/api/auth/logout", {});
    } catch {
      /* ignore */
    }
    api.setAccessToken(null);
    api.setOrganizationId(null);
    setUser(null);
    setOrganization(null);
    setPermissions([]);
    setIsSuperAdmin(false);
  };

  const switchOrganization = async (orgId: string) => {
    api.setOrganizationId(orgId);
    await refreshMe();
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      isSuperAdmin,
      organization,
      loading,
      login,
      logout,
      refreshMe,
      switchOrganization,
      hasPermission: (code: string) => permissions.includes(code),
    }),
    [user, permissions, isSuperAdmin, organization, loading, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
