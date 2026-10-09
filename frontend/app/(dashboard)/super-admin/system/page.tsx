"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileWarning,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  Users,
  Building2,
} from "lucide-react";
import { api } from "@/lib/api";
import { DashboardShell, PageHeader, StatCard } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ServiceCheck = {
  status: string;
  detail?: string;
  collections?: number;
  bucket?: string;
  exists?: boolean;
  endpoint?: string;
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

const SERVICES: Record<
  string,
  { label: string; role: string; icon: typeof Database }
> = {
  database: {
    label: "PostgreSQL",
    role: "Comptes, organisations, documents et conversations",
    icon: Database,
  },
  redis: {
    label: "Redis",
    role: "File d’indexation et événements du pipeline",
    icon: Activity,
  },
  qdrant: {
    label: "Qdrant",
    role: "Collections vectorielles des knowledge bases",
    icon: Layers,
  },
  minio: {
    label: "MinIO",
    role: "Stockage des fichiers uploadés",
    icon: HardDrive,
  },
};

const STATUS_LABEL: Record<string, string> = {
  ok: "Opérationnel",
  warn: "Attention",
  error: "Indisponible",
  degraded: "Dégradé",
};

function statusVariant(status?: string): "success" | "warning" | "danger" | "secondary" {
  if (status === "ok") return "success";
  if (status === "warn") return "warning";
  if (status === "error" || status === "degraded") return "danger";
  return "secondary";
}

function serviceDetail(name: string, check: ServiceCheck) {
  if (check.detail) return check.detail;
  if (name === "qdrant" && typeof check.collections === "number") {
    return `${check.collections} collection${check.collections > 1 ? "s" : ""}`;
  }
  if (name === "minio" && check.bucket) {
    return check.exists
      ? `Bucket ${check.bucket} accessible`
      : `Bucket ${check.bucket} introuvable`;
  }
  if (check.status === "ok") return "Répond correctement";
  return "Aucune information";
}

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

  const overall = data?.status || "";
  const healthy = overall === "ok";
  const order = ["database", "redis", "qdrant", "minio"];
  const services = Object.entries(data?.services || {}).sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
  );
  const down = services.filter(([, c]) => c.status === "error").length;
  const warn = services.filter(([, c]) => c.status === "warn").length;

  return (
    <DashboardShell title="Santé système" breadcrumbs={["Super Admin", "Système"]}>
      <PageHeader
        description="Base de données, file Redis, collections Qdrant et stockage MinIO."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Rafraîchir
          </Button>
        }
      />

      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-4",
          healthy ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5"
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-11 items-center justify-center rounded-xl",
              healthy ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
            )}
          >
            {healthy ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
          </div>
          <div>
            <p className="text-sm font-semibold">
              {healthy ? "Toutes les dépendances répondent" : "Une dépendance nécessite une action"}
            </p>
            <p className="text-xs text-muted-foreground">
              {services.length} services contrôlés
              {down ? ` · ${down} indisponible${down > 1 ? "s" : ""}` : ""}
              {warn ? ` · ${warn} en attention` : ""}
            </p>
          </div>
        </div>
        <Badge variant={statusVariant(overall)} className="px-2.5 py-1">
          {STATUS_LABEL[overall] || overall || "—"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organisations"
          value={data?.stats?.total_organizations}
          icon={<Building2 className="size-4" />}
        />
        <StatCard
          label="Utilisateurs"
          value={data?.stats?.total_users}
          icon={<Users className="size-4" />}
        />
        <StatCard
          label="Docs en cours"
          value={data?.stats?.documents_processing}
          hint="File d’indexation"
          icon={<Server className="size-4" />}
        />
        <StatCard
          label="Docs en échec"
          value={data?.stats?.documents_failed}
          hint="À relancer depuis Documents"
          icon={<FileWarning className="size-4" />}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {services.map(([name, check]) => {
          const meta = SERVICES[name] || {
            label: name,
            role: "Dépendance plateforme",
            icon: Server,
          };
          const Icon = meta.icon;
          const ok = check.status === "ok";
          return (
            <Card
              key={name}
              className={cn("border-primary/15", !ok && "border-destructive/30")}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex size-10 items-center justify-center rounded-lg",
                      ok ? "bg-primary/15 text-primary" : "bg-destructive/10 text-destructive"
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{meta.label}</CardTitle>
                    <CardDescription>{meta.role}</CardDescription>
                  </div>
                </div>
                <Badge variant={statusVariant(check.status)}>
                  {STATUS_LABEL[check.status] || check.status}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{serviceDetail(name, check)}</p>
                {check.endpoint ? (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{check.endpoint}</p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DashboardShell>
  );
}
