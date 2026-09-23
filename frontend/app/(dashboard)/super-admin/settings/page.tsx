"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DashboardShell, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";

type PlatformSettings = {
  app_name?: string;
  frontend_url?: string;
  max_upload_size_mb?: number;
  allowed_extensions?: string[];
  cohere_embed_model?: string;
  llm_model?: string;
  qdrant_collection?: string;
  jwt_access_minutes?: number | null;
};

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  useEffect(() => {
    api
      .get<PlatformSettings>("/api/admin/settings")
      .then((r) => setSettings(r.data))
      .catch((e: Error) => toast.error(e.message));
  }, []);

  const rows: { label: string; value: ReactNode }[] = [
    { label: "Application", value: settings?.app_name || "—" },
    { label: "URL frontend", value: settings?.frontend_url || "—" },
    {
      label: "Taille max upload",
      value: settings?.max_upload_size_mb != null ? `${settings.max_upload_size_mb} Mo` : "—",
    },
    {
      label: "Extensions autorisées",
      value: (
        <div className="flex flex-wrap gap-1.5">
          {(settings?.allowed_extensions || []).map((ext) => (
            <Badge key={ext} variant="secondary">
              .{ext}
            </Badge>
          ))}
          {!settings?.allowed_extensions?.length ? "—" : null}
        </div>
      ),
    },
    { label: "Modèle embeddings", value: settings?.cohere_embed_model || "—" },
    { label: "Modèle LLM", value: settings?.llm_model || "—" },
    { label: "Collection Qdrant", value: settings?.qdrant_collection || "—" },
    {
      label: "JWT accès",
      value:
        settings?.jwt_access_minutes != null ? `${settings.jwt_access_minutes} min` : "—",
    },
  ];

  return (
    <DashboardShell title="Paramètres" breadcrumbs={["Super Admin", "Paramètres"]}>
      <PageHeader
        description="Paramètres runtime en lecture seule. Modifiez-les via les variables d’environnement."
      />
      <div className="rounded-xl border border-border divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-sm text-muted-foreground">{row.label}</span>
            <div className="text-sm font-medium sm:text-right">{row.value}</div>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
