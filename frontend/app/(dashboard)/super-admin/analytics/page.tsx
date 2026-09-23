"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DashboardShell, EmptyState, PageHeader, StatCard } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";

type OrgBreakdown = {
  id: string;
  name: string;
  slug: string;
  status: string;
  members: number;
  documents: number;
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

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    api
      .get<Analytics>("/api/admin/analytics")
      .then((r) => setData(r.data))
      .catch((e: Error) => toast.error(e.message));
  }, []);

  const statusEntries = Object.entries(data?.documents_by_status || {});

  return (
    <DashboardShell title="Analytique" breadcrumbs={["Super Admin", "Analytique"]}>
      <PageHeader
        description="Répartition de l’usage par organisation et état du pipeline documentaire."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organisations" value={data?.total_organizations} />
        <StatCard label="Suspendues" value={data?.suspended_organizations} />
        <StatCard label="Utilisateurs" value={data?.total_users} />
        <StatCard label="Knowledge bases" value={data?.total_knowledge_bases} />
        <StatCard label="Documents" value={data?.total_documents} />
        <StatCard label="En traitement" value={data?.documents_processing} />
        <StatCard label="Échecs indexation" value={data?.documents_failed} />
        <StatCard label="Conversations" value={data?.total_conversations} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border p-4 lg:col-span-1">
          <h3 className="text-sm font-semibold">Documents par statut</h3>
          {statusEntries.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Aucune donnée</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {statusEntries.map(([status, count]) => (
                <li key={status} className="flex items-center justify-between text-sm">
                  <Badge variant="secondary">{status}</Badge>
                  <span className="tabular-nums font-medium">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border overflow-hidden lg:col-span-2">
          {(data?.organizations_breakdown || []).length === 0 ? (
            <EmptyState title="Aucune organisation" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Organisation</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium">Membres</th>
                  <th className="px-4 py-3 font-medium">Docs</th>
                  <th className="px-4 py-3 font-medium">Assistants</th>
                  <th className="px-4 py-3 font-medium">Chats</th>
                </tr>
              </thead>
              <tbody>
                {(data?.organizations_breakdown || []).map((org) => (
                  <tr key={org.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{org.name}</div>
                      <div className="text-xs text-muted-foreground">{org.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={org.status === "active" ? "success" : "warning"}>
                        {org.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{org.members}</td>
                    <td className="px-4 py-3 tabular-nums">{org.documents}</td>
                    <td className="px-4 py-3 tabular-nums">{org.assistants}</td>
                    <td className="px-4 py-3 tabular-nums">{org.conversations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
