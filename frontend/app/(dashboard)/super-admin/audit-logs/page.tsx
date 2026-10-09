"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, LogIn, ScrollText, Users } from "lucide-react";
import { api } from "@/lib/api";
import { DashboardShell, EmptyState, PageHeader, StatCard } from "@/components/layout/app-shell";
import { UserAvatar } from "@/components/users/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  actor_name?: string | null;
  actor_email?: string | null;
  organization_name?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  ip_address?: string | null;
  created_at?: string | null;
};

type AuditSummary = {
  total?: number;
  today?: number;
  logins?: number;
  actors?: number;
};

type AuditMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  summary?: AuditSummary;
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Connexion",
  "auth.logout": "Déconnexion",
  "auth.logout_all": "Déconnexion de toutes les sessions",
  "assistant.create": "Assistant créé",
  "assistant.update": "Assistant modifié",
  "assistant.delete": "Assistant supprimé",
  "assistant.access.update": "Accès assistant modifié",
  "organization.create": "Organisation créée",
  "organization.update": "Organisation modifiée",
  "organization.logo_update": "Logo modifié",
  "organization.logo_delete": "Logo retiré",
  "organization.suspend": "Organisation suspendue",
  "organization.activate": "Organisation réactivée",
  "organization.delete": "Organisation supprimée",
  "member.create": "Membre ajouté",
  "member.update": "Membre modifié",
  "member.delete": "Membre retiré",
  "invitation.create": "Invitation envoyée",
  "document.upload": "Document ajouté",
  "document.update": "Document modifié",
  "document.delete": "Document supprimé",
  "knowledge_base.create": "Knowledge base créée",
  "knowledge_base.update": "Knowledge base modifiée",
  "knowledge_base.delete": "Knowledge base supprimée",
  "conversation.update": "Conversation modifiée",
  "conversation.delete": "Conversation supprimée",
  "platform.settings.update": "Paramètres plateforme",
  "user.create": "Utilisateur créé",
  "user.update": "Utilisateur modifié",
  "user.delete": "Utilisateur supprimé",
  "user.reset_password": "Mot de passe réinitialisé",
  "profile.update": "Profil modifié",
  "profile.password_change": "Mot de passe changé",
  "profile.avatar_update": "Photo de profil mise à jour",
  "profile.avatar_delete": "Photo de profil retirée",
};

const RESOURCE_LABELS: Record<string, string> = {
  assistant: "Assistant",
  organization: "Organisation",
  user: "Utilisateur",
  document: "Document",
  knowledge_base: "Knowledge base",
  conversation: "Conversation",
  invitation: "Invitation",
  organization_member: "Membre",
  platform: "Plateforme",
};

const FILTERS = [
  { value: "all", label: "Tout" },
  { value: "auth", label: "Connexions" },
  { value: "assistant", label: "Assistants" },
  { value: "organization", label: "Organisations" },
  { value: "content", label: "Contenu" },
  { value: "account", label: "Comptes" },
];

function actionLabel(action: string) {
  return ACTION_LABELS[action] || action.replaceAll(".", " · ").replaceAll("_", " ");
}

function actionGroup(action: string) {
  const prefix = action.split(".")[0];
  if (prefix === "auth") return "auth";
  if (prefix === "assistant") return "assistant";
  if (prefix === "organization" || prefix === "member" || prefix === "invitation") return "organization";
  if (prefix === "document" || prefix === "knowledge_base" || prefix === "conversation") return "content";
  if (prefix === "user" || prefix === "profile" || prefix === "platform") return "account";
  return "other";
}

function actionVariant(action: string): "success" | "danger" | "info" | "soft" | "muted" {
  if (action.endsWith(".delete") || action.endsWith(".suspend") || action.includes("logo_delete")) {
    return "danger";
  }
  if (action.endsWith(".create") || action === "organization.activate" || action === "auth.login") {
    return action === "auth.login" ? "info" : "success";
  }
  if (action.startsWith("auth.")) return "muted";
  return "soft";
}

function formatWhen(iso?: string | null) {
  if (!iso) return { relative: "—", exact: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { relative: "—", exact: "" };
  const exact = date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return { relative: "À l'instant", exact };
  if (minutes < 60) return { relative: `Il y a ${minutes} min`, exact };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { relative: `Il y a ${hours} h`, exact };
  const days = Math.round(hours / 24);
  if (days < 7) return { relative: `Il y a ${days} j`, exact };
  return { relative: exact, exact: "" };
}

function isLocalIp(ip?: string | null) {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.");
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(async (nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await api.get<AuditLog[]>(`/api/admin/audit-logs?page=${nextPage}&per_page=50`);
      const meta = (res.meta || {}) as AuditMeta;
      setLogs((prev) => (append ? [...prev, ...(res.data || [])] : res.data || []));
      setTotal(meta.total ?? res.data?.length ?? 0);
      if (meta.summary) setSummary(meta.summary);
      setPage(nextPage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de charger le journal");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(1, false);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (filter !== "all" && actionGroup(log.action) !== filter) return false;
      if (!q) return true;
      const label = actionLabel(log.action).toLowerCase();
      return (
        log.action.toLowerCase().includes(q) ||
        label.includes(q) ||
        (log.actor_name || "").toLowerCase().includes(q) ||
        (log.actor_email || "").toLowerCase().includes(q) ||
        (log.organization_name || "").toLowerCase().includes(q) ||
        (log.resource_type || "").toLowerCase().includes(q) ||
        (log.ip_address || "").toLowerCase().includes(q)
      );
    });
  }, [logs, query, filter]);

  return (
    <DashboardShell title="Journal d'audit" breadcrumbs={["Super Admin", "Journal d'audit"]}>
      <PageHeader description="Qui a fait quoi sur la plateforme, avec l'acteur, l'organisation et l'heure." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Événements" value={summary?.total ?? total} hint="Depuis le début" icon={<ScrollText className="size-4" />} />
        <StatCard label="Aujourd'hui" value={summary?.today ?? "—"} hint="Depuis minuit" icon={<ScrollText className="size-4" />} />
        <StatCard label="Connexions" value={summary?.logins ?? "—"} hint="Toutes les sessions ouvertes" icon={<LogIn className="size-4" />} />
        <StatCard label="Acteurs" value={summary?.actors ?? "—"} hint="Comptes distincts" icon={<Users className="size-4" />} />
      </div>

      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Action, acteur, organisation, IP…"
        filters={FILTERS}
        activeFilter={filter}
        onFilterChange={setFilter}
        countLabel={`${filtered.length} affichés`}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucun événement" description="Aucun journal ne correspond à cette recherche." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quand</TableHead>
                <TableHead>Acteur</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Ressource</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Origine</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log) => {
                const when = formatWhen(log.created_at);
                const resource = log.resource_type
                  ? RESOURCE_LABELS[log.resource_type] || log.resource_type
                  : "—";
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="text-sm font-medium">{when.relative}</div>
                      {when.exact ? (
                        <div className="text-xs text-muted-foreground">{when.exact}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar
                          name={log.actor_name}
                          email={log.actor_email}
                          className="size-8"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {log.actor_name || "Système"}
                          </div>
                          {log.actor_email ? (
                            <div className="truncate text-xs text-muted-foreground">{log.actor_email}</div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionVariant(log.action)}>{actionLabel(log.action)}</Badge>
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">{log.action}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{resource}</div>
                      {log.resource_id ? (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {log.resource_id.slice(0, 8)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {log.organization_name ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Building2 className="size-3.5 text-muted-foreground" />
                          {log.organization_name}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Plateforme</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-mono text-xs">{log.ip_address || "—"}</div>
                      {isLocalIp(log.ip_address) ? (
                        <div className="text-[10px] text-muted-foreground">Réseau local</div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {!loading && logs.length < total ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void load(page + 1, true)}>
            {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
            Voir la suite ({logs.length} / {total})
          </Button>
        </div>
      ) : null}
    </DashboardShell>
  );
}
