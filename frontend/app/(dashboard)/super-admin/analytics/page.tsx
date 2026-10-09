"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  FileText,
  Library,
  Loader2,
  MessageSquare,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { DashboardShell, EmptyState, PageHeader, StatCard } from "@/components/layout/app-shell";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type OrgBreakdown = {
  id: string;
  name: string;
  slug: string;
  status: string;
  logo_url?: string | null;
  is_super_admin_workspace?: boolean;
  members: number;
  documents: number;
  knowledge_bases?: number;
  assistants: number;
  conversations: number;
};

type Analytics = {
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
  organizations_breakdown?: OrgBreakdown[];
};

const DOC_STATUS: Record<string, { label: string; tone: string }> = {
  indexed: { label: "Indexés", tone: "bg-primary" },
  processing: { label: "En cours", tone: "bg-sky-400" },
  pending: { label: "En attente", tone: "bg-sky-700" },
  failed: { label: "Échecs", tone: "bg-slate-400" },
};

const ORG_STATUS: Record<string, string> = {
  active: "Active",
  invited: "Invitée",
  suspended: "Suspendue",
};

const orgsConfig = {
  documents: { label: "Documents", color: "var(--chart-1)" },
  conversations: { label: "Conversations", color: "var(--chart-2)" },
} satisfies ChartConfig;

function Metric({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="min-w-[72px]">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/80" style={{ width: value ? `${pct}%` : "0%" }} />
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<Analytics>("/api/admin/analytics")
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const orgs = data?.organizations_breakdown || [];
  const tenants = orgs.filter((o) => !o.is_super_admin_workspace);
  const workspaces = orgs.filter((o) => o.is_super_admin_workspace);

  const statusRows = useMemo(() => {
    const raw = data?.documents_by_status || {};
    const total = Object.values(raw).reduce((sum, n) => sum + n, 0) || 0;
    const known = Object.keys(DOC_STATUS);
    const entries = [
      ...known.filter((k) => raw[k] != null).map((k) => [k, raw[k]] as const),
      ...Object.entries(raw).filter(([k]) => !known.includes(k)),
    ];
    return entries.map(([status, count]) => ({
      status,
      label: DOC_STATUS[status]?.label || status,
      tone: DOC_STATUS[status]?.tone || "bg-primary/50",
      count,
      pct: total ? Math.round((count / total) * 100) : 0,
    }));
  }, [data]);

  const chartOrgs = useMemo(
    () =>
      [...orgs]
        .sort((a, b) => b.documents + b.conversations - (a.documents + a.conversations))
        .slice(0, 8)
        .map((o) => ({
          ...o,
          short: o.name.length > 14 ? `${o.name.slice(0, 14)}…` : o.name,
        })),
    [orgs]
  );

  const maxDocs = Math.max(1, ...orgs.map((o) => o.documents));
  const maxChats = Math.max(1, ...orgs.map((o) => o.conversations));
  const maxMembers = Math.max(1, ...orgs.map((o) => o.members));

  return (
    <DashboardShell title="Analytique" breadcrumbs={["Super Admin", "Analytique"]}>
      <PageHeader description="Usage par organisation et état du pipeline documentaire." />

      {loading ? (
        <div className="flex justify-center py-24 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Organisations"
              value={data?.total_organizations}
              hint={`${data?.active_organizations ?? 0} actives · ${data?.suspended_organizations ?? 0} suspendues`}
              icon={<Building2 className="size-4" />}
            />
            <StatCard
              label="Utilisateurs"
              value={data?.total_users}
              hint={`${tenants.length} tenant${tenants.length > 1 ? "s" : ""} hors espace SA`}
              icon={<Users className="size-4" />}
            />
            <StatCard
              label="Knowledge bases"
              value={data?.total_knowledge_bases}
              hint={`${data?.total_assistants ?? 0} assistants`}
              icon={<Library className="size-4" />}
            />
            <StatCard
              label="Documents"
              value={data?.total_documents}
              hint={`${data?.documents_processing ?? 0} en cours · ${data?.documents_failed ?? 0} échecs · ${data?.total_conversations ?? 0} chats`}
              icon={<FileText className="size-4" />}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="border-primary/15 xl:col-span-1">
              <CardHeader>
                <CardTitle>Pipeline documentaire</CardTitle>
                <CardDescription>Répartition des documents par état</CardDescription>
              </CardHeader>
              <CardContent>
                {statusRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Aucun document</p>
                ) : (
                  <ul className="space-y-4">
                    {statusRows.map((row) => (
                      <li key={row.status}>
                        <div className="mb-1.5 flex items-center justify-between text-sm">
                          <span className="font-medium">{row.label}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {row.count}
                            <span className="ml-1 text-xs">{row.pct}%</span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${row.pct}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Bot className="size-3.5 text-primary" />
                    {data?.total_assistants ?? 0} assistants
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="size-3.5 text-primary" />
                    {data?.total_conversations ?? 0} conversations
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/15 xl:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle>Volume par organisation</CardTitle>
                  <CardDescription>Documents et conversations</CardDescription>
                </div>
                <Link
                  href="/super-admin/organizations"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Organisations
                  <ArrowRight className="size-3.5" />
                </Link>
              </CardHeader>
              <CardContent>
                {chartOrgs.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">Aucune organisation</p>
                ) : (
                  <ChartContainer config={orgsConfig} className="aspect-[16/7] w-full">
                    <BarChart data={chartOrgs} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="short" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
                      <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="documents" fill="var(--color-documents)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="conversations" fill="var(--color-conversations)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden border-primary/15">
            <CardHeader>
              <CardTitle>Détail par organisation</CardTitle>
              <CardDescription>
                {tenants.length} organisation{tenants.length > 1 ? "s" : ""}
                {workspaces.length ? ` · ${workspaces.length} espace super admin` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {orgs.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="Aucune organisation" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organisation</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Membres</TableHead>
                      <TableHead>Docs</TableHead>
                      <TableHead>KB</TableHead>
                      <TableHead>Assistants</TableHead>
                      <TableHead>Chats</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgs.map((org) => (
                      <TableRow key={org.id}>
                        <TableCell>
                          <Link
                            href={`/super-admin/organizations/${org.id}`}
                            className="flex items-center gap-3"
                          >
                            <OrgLogo name={org.name} logoUrl={org.logo_url} className="size-9 rounded-lg" />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{org.name}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {org.is_super_admin_workspace ? "Espace super admin" : org.slug}
                              </div>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant={org.status === "active" ? "success" : "warning"}>
                            {ORG_STATUS[org.status] || org.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Metric label="membres" value={org.members} max={maxMembers} />
                        </TableCell>
                        <TableCell>
                          <Metric label="docs" value={org.documents} max={maxDocs} />
                        </TableCell>
                        <TableCell className="tabular-nums">{org.knowledge_bases ?? 0}</TableCell>
                        <TableCell className="tabular-nums">{org.assistants}</TableCell>
                        <TableCell>
                          <Metric label="chats" value={org.conversations} max={maxChats} />
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/super-admin/organizations/${org.id}`}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Ouvrir ${org.name}`}
                          >
                            <ArrowRight className="size-4" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardShell>
  );
}
