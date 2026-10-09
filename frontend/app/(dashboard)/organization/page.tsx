"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Bot,
  FileText,
  HardDrive,
  Users,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { DashboardShell, PageHeader, StatCard } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuotaBar } from "@/components/ui/quota-bar";
import { formatBytes } from "@/lib/utils";
import type { QuotaItem } from "@/lib/types";

type OrgStats = {
  total_members?: number;
  total_documents?: number;
  active_assistants?: number;
  knowledge_bases?: number;
  conversations?: number;
  documents_processing?: number;
  storage_usage_bytes?: number;
  quota_items?: QuotaItem[];
  recent_assistants?: {
    id: string;
    name: string;
    is_active: boolean;
    llm_provider?: string | null;
  }[];
  recent_documents?: {
    id: string;
    name: string;
    status: string;
    created_at?: string | null;
  }[];
};

const shortcuts = [
  {
    href: "/organization/members",
    label: "Membres",
    description: "Créer des users et leur rattacher des assistants",
    icon: Users,
  },
  {
    href: "/organization/assistants",
    label: "Assistants",
    description: "Vue globale et gestion des accès",
    icon: Bot,
  },
  {
    href: "/organization/documents",
    label: "Documents",
    description: "Consultation du corpus provisionné",
    icon: FileText,
  },
  {
    href: "/organization/knowledge-bases",
    label: "Knowledge bases",
    description: "Collections Qdrant de l’organisation",
    icon: BookOpen,
  },
];

export default function OrgDashboard() {
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<OrgStats>("/api/organization/dashboard")
      .then((r) => setStats(r.data))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardShell title="Overview" breadcrumbs={["Organisation"]}>
      <PageHeader description="Vue globale de votre espace — contenu géré par la plateforme, vous pilotez les membres et leurs accès." />

      {loading ? (
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Membres" value={stats?.total_members} />
            <StatCard label="Assistants actifs" value={stats?.active_assistants} />
            <StatCard label="Knowledge bases" value={stats?.knowledge_bases} />
            <StatCard label="Documents" value={stats?.total_documents} />
            <StatCard label="Conversations" value={stats?.conversations} />
            <StatCard label="En traitement" value={stats?.documents_processing} />
            <StatCard
              label="Stockage"
              value={formatBytes(stats?.storage_usage_bytes)}
              icon={<HardDrive className="size-4" />}
            />
          </div>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {shortcuts.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="size-4" />
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </div>
                <p className="mt-3 text-sm font-semibold">{item.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
              </Link>
            ))}
          </section>

          {(stats?.quota_items?.length || 0) > 0 ? (
            <section className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Quotas</h2>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/organization/settings">Paramètres</Link>
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {stats?.quota_items?.map((item) => (
                  <QuotaBar key={item.key} item={item} />
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Assistants</h2>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/organization/assistants">Gérer les accès</Link>
                </Button>
              </div>
              {(stats?.recent_assistants?.length || 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun assistant pour l’instant — ils sont provisionnés par le super admin.
                </p>
              ) : (
                <ul className="space-y-2">
                  {stats?.recent_assistants?.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{a.name}</span>
                      <Badge variant={a.is_active ? "success" : "warning"}>
                        {a.is_active ? "Actif" : "Inactif"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Documents récents</h2>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/organization/documents">Voir tout</Link>
                </Button>
              </div>
              {(stats?.recent_documents?.length || 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun document indexé.</p>
              ) : (
                <ul className="space-y-2">
                  {stats?.recent_documents?.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-medium">{d.name}</span>
                      <Badge variant="muted">{d.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
