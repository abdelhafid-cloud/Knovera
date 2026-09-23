import type { ApiResponse } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const ACCESS_KEY = "access_token";

export class ApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
};

/**
 * Access token : mémoire + sessionStorage (survit au F5 dans l'onglet, pas localStorage).
 * Refresh : cookie HttpOnly uniquement.
 */
let memoryAccessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

function readSessionAccess(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

function writeSessionAccess(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) sessionStorage.setItem(ACCESS_KEY, token);
    else sessionStorage.removeItem(ACCESS_KEY);
    // Nettoyer l'ancien stockage XSS-persistant
    localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* private mode */
  }
}

class ApiClient {
  organizationId: string | null = null;

  constructor() {
    this.hydrateFromStorage();
  }

  get accessToken(): string | null {
    return memoryAccessToken ?? readSessionAccess();
  }

  hydrateFromStorage() {
    if (typeof window === "undefined") return;
    memoryAccessToken = readSessionAccess();
    this.organizationId = localStorage.getItem("organization_id");
    // Migration : ne plus garder l'access dans localStorage
    if (localStorage.getItem(ACCESS_KEY)) {
      const legacy = localStorage.getItem(ACCESS_KEY);
      if (legacy && !memoryAccessToken) {
        memoryAccessToken = legacy;
        writeSessionAccess(legacy);
      }
      localStorage.removeItem(ACCESS_KEY);
    }
  }

  setAccessToken(token: string | null) {
    memoryAccessToken = token;
    writeSessionAccess(token);
  }

  setOrganizationId(id: string | null) {
    this.organizationId = id;
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem("organization_id", id);
      else localStorage.removeItem("organization_id");
    }
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    this.hydrateFromStorage();
    const { method = "GET", body, formData, headers = {} } = options;
    const finalHeaders: Record<string, string> = { ...headers };
    const token = this.accessToken;

    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
    if (this.organizationId) {
      finalHeaders["X-Organization-Id"] = this.organizationId;
    }

    let payload: BodyInit | undefined;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      finalHeaders["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: payload,
      credentials: "include",
    }).catch(() => {
      throw new ApiError(
        `Impossible de joindre l'API (${API_URL}). Vérifiez que le backend et Docker tournent.`,
        0,
        "network_error"
      );
    });

    const json = (await res.json().catch(() => ({
      success: false,
      data: null,
      error: { message: "Réponse invalide" },
      meta: null,
    }))) as ApiResponse<T>;

    if (res.status === 401 && !path.includes("/auth/login") && !path.includes("/auth/refresh")) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.request<T>(path, options);
      }
    }

    if (!res.ok || json.success === false) {
      throw new ApiError(json?.error?.message || "Erreur API", res.status, json?.error?.code);
    }
    return json;
  }

  /** Mutex : une seule rotation refresh à la fois. */
  async tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const json = (await res.json()) as ApiResponse<{ access_token: string }>;
        if (!res.ok || !json.success || !json.data?.access_token) {
          this.setAccessToken(null);
          return false;
        }
        this.setAccessToken(json.data.access_token);
        return true;
      } catch {
        this.setAccessToken(null);
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  get<T = unknown>(path: string) {
    return this.request<T>(path);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PATCH", body });
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PUT", body });
  }

  delete<T = unknown>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  upload<T = unknown>(path: string, formData: FormData) {
    return this.request<T>(path, { method: "POST", formData });
  }

  async getBlob(path: string): Promise<Blob> {
    this.hydrateFromStorage();
    const headers: Record<string, string> = {};
    const token = this.accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.organizationId) headers["X-Organization-Id"] = this.organizationId;

    const res = await fetch(`${API_URL}${path}`, {
      method: "GET",
      headers,
      credentials: "include",
    }).catch(() => {
      throw new ApiError(
        `Impossible de joindre l'API (${API_URL}). Vérifiez que le backend et Docker tournent.`,
        0,
        "network_error"
      );
    });

    if (res.status === 401) {
      const refreshed = await this.tryRefresh();
      if (refreshed) return this.getBlob(path);
    }

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new ApiError(
        json?.error?.message || "Impossible de télécharger le fichier",
        res.status,
        json?.error?.code
      );
    }
    return res.blob();
  }
}

export const api = new ApiClient();
