"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DashboardShell, PageHeader, StatCard } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ServiceCheck = {
  status: string;
  detail?: string;
  collections?: number;
  bucket?: string;
  exists?: boolean;
};

type SystemPayload = {
  status?: string;
  services?: Record<string, ServiceCheck>;
  stats?: {
    total_organizations?: number;
    total_users?: number;
    documents_processing?: number;
    documents_failed?: number;
  };
};

const statusVariant: Record<string, "success" | "warning" | "danger" | "secondary"> = {
  ok: "success",
  warn: "warning",
  degraded: "danger",
  error: "danger",
};

export default function SystemPage() {
  const [data, setData] = useState<SystemPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<SystemPayload>("/api/admin/system");
      setData(r.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const services = Object.entries(data?.services || {});

  return (
    <DashboardShell title="Santé système" breadcrumbs={["Super Admin", "Système"]}>
      <PageHeader
        description="État des dépendances critiques : base de données, Redis, Qdrant et MinIO."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? "Vérification…" : "Rafraîchir"}
          </Button>
        }
      />

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Statut global</span>
        <Badge variant={statusVariant[data?.status || ""] || "secondary"}>
          {data?.status || "—"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organisations" value={data?.stats?.total_organizations} />
        <StatCard label="Utilisateurs" value={data?.stats?.total_users} />
        <StatCard label="Docs en cours" value={data?.stats?.documents_processing} />
        <StatCard label="Docs en échec" value={data?.stats?.documents_failed} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {services.map(([name, check]) => (
          <div key={name} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold capitalize">{name}</h3>
              <Badge variant={statusVariant[check.status] || "secondary"}>{check.status}</Badge>
            </div>
            {check.detail ? (
              <p className="mt-2 text-xs text-muted-foreground break-all">{check.detail}</p>
            ) : null}
            {typeof check.collections === "number" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Collections Qdrant : {check.collections}
              </p>
            ) : null}
            {check.bucket ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Bucket {check.bucket} {check.exists ? "présent" : "absent"}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
