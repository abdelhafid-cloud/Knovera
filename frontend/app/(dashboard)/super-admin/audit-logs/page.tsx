"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableToolbar } from "@/components/ui/table-toolbar";

type AuditLog = {
  id: string;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  ip_address?: string | null;
  created_at?: string | null;
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get<AuditLog[]>("/api/admin/audit-logs")
      .then((r) => setLogs(r.data || []))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        (l.resource_type || "").toLowerCase().includes(q) ||
        (l.ip_address || "").toLowerCase().includes(q)
    );
  }, [logs, query]);

  return (
    <DashboardShell title="Audit logs" breadcrumbs={["Super Admin", "Audit"]}>
      <PageHeader
        description="Actions sensibles sur la plateforme."
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Action, ressource, IP…"
        countLabel={`${filtered.length} / ${logs.length}`}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucun log" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Ressource</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {l.created_at ? new Date(l.created_at).toLocaleString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="font-medium">{l.action}</TableCell>
                  <TableCell>
                    {l.resource_type}{" "}
                    {l.resource_id ? `#${l.resource_id.slice(0, 8)}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.ip_address || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </DashboardShell>
  );
}
