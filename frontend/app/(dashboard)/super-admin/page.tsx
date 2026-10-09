"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  FileText,
  Library,
  MessageSquare,
  Users,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { PlatformAlert } from "@/lib/types";
import { DashboardShell, PageHeader, StatCard } from "@/components/layout/app-shell";
import { OrgLogo } from "@/components/organizations/org-logo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

type ActivityPoint = {
  date: string;
  label: string;
  users: number;
  documents: number;
  conversations: number;
};

type TopOrg = {
  id: string;
  name: string;
  logo_url?: string | null;
  status?: string;
  documents: number;
  conversations: number;
  assistants: number;
  knowledge_bases?: number;
  members?: number;
};

type PlatformStats = {
  total_organizations?: number;
  active_organizations?: number;
  suspended_organizations?: number;
  total_users?: number;
  total_assistants?: number;
  total_documents?: number;
  total_conversations?: number;
  total_knowledge_bases?: number;
  documents_processing?: number;
  documents_failed?: number;
  documents_by_status?: Record<string, number>;
  organizations_by_status?: Record<string, number>;
  activity_series?: ActivityPoint[];
  top_organizations?: TopOrg[];
  alerts?: PlatformAlert[];
};

const DOC_STATUS_LABELS: Record<string, string> = {
  indexed: "Indexés",
  processing: "En cours",
  pending: "En attente",
  failed: "Échecs",
};

const activityConfig = {
  documents: { label: "Documents", color: "var(--chart-1)" },
  conversations: { label: "Conversations", color: "var(--chart-2)" },
  users: { label: "Utilisateurs", color: "var(--chart-3)" },
} satisfies ChartConfig;

const docsConfig = {
  indexed: { label: "Indexés", color: "var(--chart-1)" },
  processing: { label: "En cours", color: "var(--chart-2)" },
  pending: { label: "En attente", color: "var(--chart-5)" },
  failed: { label: "Échecs", color: "var(--chart-3)" },
  other: { label: "Autres", color: "var(--chart-4)" },
} satisfies ChartConfig;

const orgsConfig = {
  documents: { label: "Documents", color: "var(--chart-1)" },
  conversations: { label: "Conversations", color: "var(--chart-2)" },
} satisfies ChartConfig;

const orgStatusConfig = {
  active: { label: "Actives", color: "var(--chart-1)" },
  invited: { label: "Invitées", color: "var(--chart-2)" },
  suspended: { label: "Suspendues", color: "var(--chart-3)" },
  other: { label: "Autres", color: "var(--chart-5)" },
} satisfies ChartConfig;

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    api
      .get<PlatformStats>("/api/admin/dashboard")
      .then((res) => setStats(res.data))
      .catch(() => setStats(null));
  }, []);

  const docsPie = useMemo(() => {
    const entries = Object.entries(stats?.documents_by_status || {});
    if (!entries.length) return [];
    return entries.map(([status, value]) => ({
      status,
      label: DOC_STATUS_LABELS[status] || status,
      value,
      fill: `var(--color-${status in docsConfig ? status : "other"})`,
    }));
  }, [stats]);

  const orgsPie = useMemo(() => {
    const entries = Object.entries(stats?.organizations_by_status || {});
    if (!entries.length) return [];
    return entries.map(([status, value]) => ({
      status,
      label: (orgStatusConfig as Record<string, { label: string }>)[status]?.label || status,
      value,
      fill: `var(--color-${status in orgStatusConfig ? status : "other"})`,
    }));
  }, [stats]);

  const topOrgs = stats?.top_organizations || [];
  const activity = stats?.activity_series || [];
  const alerts = stats?.alerts || [];

  return (
    <DashboardShell title="Overview" breadcrumbs={["Super Admin"]}>
      <PageHeader description="Vue plateforme — cartes et tendances sur palette bleue." />

      {alerts.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Alertes opérationnelles</h2>
          <div className="grid gap-2">
            {alerts.map((alert) => (
              <Link
                key={alert.id}
                href={alert.href || "#"}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/40",
                  alert.severity === "danger" && "border-primary/40 bg-primary/5",
                  alert.severity === "warning" && "border-sky-500/35 bg-sky-500/5",
                  alert.severity === "info" && "border-primary/30 bg-primary/5"
                )}
              >
                <AlertTriangle
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-primary",
                    alert.severity === "warning" && "text-sky-600"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{alert.title}</p>
                  {alert.description ? (
                    <p className="text-xs text-muted-foreground">{alert.description}</p>
                  ) : null}
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Organisations"
          value={stats?.total_organizations}
          hint={`${stats?.active_organizations ?? 0} actives`}
          icon={<Building2 className="size-4" />}
        />
        <StatCard
          label="Utilisateurs"
          value={stats?.total_users}
          icon={<Users className="size-4" />}
        />
        <StatCard
          label="Knowledge bases"
          value={stats?.total_knowledge_bases}
          icon={<Library className="size-4" />}
        />
        <StatCard
          label="Assistants"
          value={stats?.total_assistants}
          icon={<Bot className="size-4" />}
        />
        <StatCard
          label="Documents"
          value={stats?.total_documents}
          hint={`${stats?.documents_processing ?? 0} en cours`}
          icon={<FileText className="size-4" />}
        />
        <StatCard
          label="Échecs indexation"
          value={stats?.documents_failed}
          hint={`${stats?.total_conversations ?? 0} conversations`}
          icon={<MessageSquare className="size-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 border-primary/15">
          <CardHeader>
            <CardTitle>Activité (14 jours)</CardTitle>
            <CardDescription>Documents, conversations et utilisateurs (nuances de bleu)</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={activityConfig} className="aspect-[16/7] w-full">
              <AreaChart data={activity} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area
                  type="monotone"
                  dataKey="documents"
                  stroke="var(--color-documents)"
                  fill="var(--color-documents)"
                  fillOpacity={0.28}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="conversations"
                  stroke="var(--color-conversations)"
                  fill="var(--color-conversations)"
                  fillOpacity={0.22}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="var(--color-users)"
                  fill="var(--color-users)"
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="border-primary/15">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Organisations</CardTitle>
              <CardDescription>Logo, nom et stats actuelles</CardDescription>
            </div>
            <Link
              href="/super-admin/organizations"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Tout voir
              <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="px-2 pb-3 pt-0 sm:px-3">
            {topOrgs.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Aucune organisation</p>
            ) : (
              <ul className="max-h-[340px] space-y-1 overflow-y-auto">
                {topOrgs.map((org) => (
                  <li key={org.id}>
                    <Link
                      href={`/super-admin/organizations/${org.id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <OrgLogo
                        name={org.name}
                        logoUrl={org.logo_url}
                        className="size-10 rounded-lg"
                        iconClassName="size-4"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{org.name}</p>
                          {org.status && org.status !== "active" ? (
                            <Badge
                              variant={org.status === "suspended" ? "muted" : "info"}
                              className="shrink-0 text-[10px] capitalize"
                            >
                              {org.status === "suspended" ? "Suspendue" : org.status}
                            </Badge>
                          ) : (
                            <Badge variant="soft" className="shrink-0 text-[10px]">
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            <span className="font-semibold tabular-nums text-foreground">
                              {org.assistants}
                            </span>{" "}
                            assistants
                          </span>
                          <span>
                            <span className="font-semibold tabular-nums text-foreground">
                              {org.knowledge_bases ?? 0}
                            </span>{" "}
                            KB
                          </span>
                          <span>
                            <span className="font-semibold tabular-nums text-foreground">
                              {org.documents}
                            </span>{" "}
                            docs
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 border-primary/15">
          <CardHeader>
            <CardTitle>Top organisations</CardTitle>
            <CardDescription>Volume documents & conversations</CardDescription>
          </CardHeader>
          <CardContent>
            {topOrgs.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Aucune organisation</p>
            ) : (
              <ChartContainer config={orgsConfig} className="aspect-[16/7] w-full">
                <BarChart data={topOrgs} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    interval={0}
                    tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 10)}…` : v)}
                  />
                  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="documents" fill="var(--color-documents)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="conversations" fill="var(--color-conversations)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="border-primary/15">
            <CardHeader>
              <CardTitle>Documents par statut</CardTitle>
              <CardDescription>État du pipeline d’indexation</CardDescription>
            </CardHeader>
            <CardContent>
              {docsPie.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Aucune donnée</p>
              ) : (
                <ChartContainer config={docsConfig} className="mx-auto aspect-square max-h-[200px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="status" hideLabel />} />
                    <Pie data={docsPie} dataKey="value" nameKey="status" innerRadius={48} strokeWidth={2}>
                      {docsPie.map((entry) => (
                        <Cell key={entry.status} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartLegend content={<ChartLegendContent nameKey="status" />} />
                  </PieChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card className="border-sky-500/20">
            <CardHeader>
              <CardTitle>Orgs par statut</CardTitle>
              <CardDescription>Répartition plateforme</CardDescription>
            </CardHeader>
            <CardContent>
              {orgsPie.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Aucune donnée</p>
              ) : (
                <ChartContainer config={orgStatusConfig} className="mx-auto aspect-square max-h-[180px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="status" hideLabel />} />
                    <Pie data={orgsPie} dataKey="value" nameKey="status" innerRadius={40} strokeWidth={2}>
                      {orgsPie.map((entry) => (
                        <Cell key={entry.status} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartLegend content={<ChartLegendContent nameKey="status" />} />
                  </PieChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
