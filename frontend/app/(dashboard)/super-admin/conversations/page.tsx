"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Conversation } from "@/lib/types";
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

type PlatformConversation = Conversation & { organization_name?: string | null };

export default function PlatformConversationsPage() {
  const [items, setItems] = useState<PlatformConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get<PlatformConversation[]>("/api/admin/conversations")
      .then((r) => setItems(r.data || []))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.organization_name || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <DashboardShell title="Conversations" breadcrumbs={["Super Admin", "Conversations"]}>
      <PageHeader
        description="Activité de chat récente sur l’ensemble des organisations."
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Titre ou organisation…"
        countLabel={`${filtered.length} / ${items.length}`}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucune conversation" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Mise à jour</TableHead>
                <TableHead>Créée</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.title || "Sans titre"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.organization_name || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {c.updated_at ? new Date(c.updated_at).toLocaleString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {c.created_at ? new Date(c.created_at).toLocaleString("fr-FR") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </DashboardShell>
  );
}
