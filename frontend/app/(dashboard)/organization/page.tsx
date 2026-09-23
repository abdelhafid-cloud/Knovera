"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DashboardShell, PageHeader, StatCard } from "@/components/layout/app-shell";
import { formatBytes } from "@/lib/utils";

type OrgStats = {
  total_members?: number;
  total_documents?: number;
  active_assistants?: number;
  knowledge_bases?: number;
  conversations?: number;
  documents_processing?: number;
  storage_usage_bytes?: number;
};

export default function OrgDashboard() {
  const [stats, setStats] = useState<OrgStats | null>(null);

  useEffect(() => {
    api
      .get<OrgStats>("/api/organization/dashboard")
      .then((r) => setStats(r.data))
      .catch(() => null);
  }, []);

  return (
    <DashboardShell title="Overview" breadcrumbs={["Organisation"]}>
      <PageHeader
        description="Activité et ressources de votre espace."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Membres" value={stats?.total_members} />
        <StatCard label="Documents" value={stats?.total_documents} />
        <StatCard label="Assistants actifs" value={stats?.active_assistants} />
        <StatCard label="Knowledge bases" value={stats?.knowledge_bases} />
        <StatCard label="Conversations" value={stats?.conversations} />
        <StatCard label="En traitement" value={stats?.documents_processing} />
        <StatCard label="Stockage" value={formatBytes(stats?.storage_usage_bytes)} />
      </div>
    </DashboardShell>
  );
}
