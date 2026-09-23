"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Organization, QuotaItem } from "@/lib/types";
import { useAuth } from "@/components/providers/auth-provider";
import { DashboardShell, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuotaBar } from "@/components/ui/quota-bar";
import { AppModal } from "@/components/ui/app-modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type MemberRow = {
  id: string;
  status: string;
  role?: { code?: string | null; name?: string | null };
  user?: {
    id: string;
    email: string;
    full_name?: string;
    is_active?: boolean;
  } | null;
};

type InvitationRow = {
  id: string;
  email: string;
  status: string;
  expires_at?: string | null;
  created_at?: string | null;
};

type QuotaForm = {
  max_members: number;
  max_documents: number;
  max_assistants: number;
  max_knowledge_bases: number;
  max_storage_gb: number;
};

export default function OrganizationDetailPage() {
  const params = useParams();
  const orgId = String(params.id || "");
  const router = useRouter();
  const { switchOrganization } = useAuth();

  const [org, setOrg] = useState<Organization | null>(null);
  const [items, setItems] = useState<QuotaItem[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingQuotas, setSavingQuotas] = useState(false);
  const [quotaForm, setQuotaForm] = useState<QuotaForm>({
    max_members: 50,
    max_documents: 500,
    max_assistants: 20,
    max_knowledge_bases: 20,
    max_storage_gb: 5,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("org_member");
  const [inviting, setInviting] = useState(false);
  const [lastInviteToken, setLastInviteToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [orgRes, membersRes, invRes] = await Promise.all([
      api.get<Organization>(`/api/organizations/${orgId}`),
      api.get<MemberRow[]>(`/api/organizations/${orgId}/members`),
      api.get<InvitationRow[]>(`/api/organizations/${orgId}/invitations`),
    ]);
    const data = orgRes.data;
    setOrg(data);
    setItems(data?.items || []);
    if (data?.quotas) {
      setQuotaForm({
        max_members: data.quotas.max_members,
        max_documents: data.quotas.max_documents,
        max_assistants: data.quotas.max_assistants,
        max_knowledge_bases: data.quotas.max_knowledge_bases,
        max_storage_gb: Math.round(data.quotas.max_storage_bytes / (1024 * 1024 * 1024)),
      });
    }
    setMembers(membersRes.data || []);
    setInvitations(invRes.data || []);
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [orgId, load]);

  const saveQuotas = async (e: FormEvent) => {
    e.preventDefault();
    setSavingQuotas(true);
    try {
      const r = await api.patch<Organization>(`/api/organizations/${orgId}`, {
        quotas: {
          max_members: Number(quotaForm.max_members),
          max_documents: Number(quotaForm.max_documents),
          max_assistants: Number(quotaForm.max_assistants),
          max_knowledge_bases: Number(quotaForm.max_knowledge_bases),
          max_storage_bytes: Number(quotaForm.max_storage_gb) * 1024 * 1024 * 1024,
        },
      });
      setOrg(r.data);
      setItems(r.data?.items || []);
      toast.success("Quotas enregistrés");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingQuotas(false);
    }
  };

  const enterOrg = async () => {
    setBusy(true);
    try {
      await switchOrganization(orgId);
      router.push("/organization");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    if (!org) return;
    setBusy(true);
    try {
      const action = org.status === "active" ? "suspend" : "activate";
      await api.post(`/api/organizations/${orgId}/${action}`);
      toast.success(action === "suspend" ? "Suspendue" : "Réactivée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const deleteOrg = async () => {
    if (!org || !confirm(`Supprimer « ${org.name} » ?`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/organizations/${orgId}`);
      toast.success("Organisation supprimée");
      router.push("/super-admin/organizations");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setBusy(false);
    }
  };

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setLastInviteToken(null);
    try {
      const r = await api.post<{ token?: string }>(`/api/organizations/${orgId}/invitations`, {
        email: inviteEmail,
        role_code: inviteRole,
      });
      setLastInviteToken(r.data?.token || null);
      toast.success("Invitation créée");
      setInviteEmail("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setInviting(false);
    }
  };

  const copyToken = async (token: string) => {
    await navigator.clipboard.writeText(token);
    toast.success("Token copié");
  };

  if (loading) {
    return (
      <DashboardShell title="Organisation" breadcrumbs={["Super Admin", "Organisations"]}>
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </DashboardShell>
    );
  }

  if (!org) {
    return (
      <DashboardShell title="Organisation" breadcrumbs={["Super Admin", "Organisations"]}>
        <p className="text-sm text-muted-foreground">Organisation introuvable.</p>
        <Button variant="outline" asChild>
          <Link href="/super-admin/organizations">Retour</Link>
        </Button>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title={org.name}
      breadcrumbs={["Super Admin", "Organisations", org.name]}
    >
      <PageHeader
        description={`${org.slug} · créée le ${
          org.created_at ? new Date(org.created_at).toLocaleDateString("fr-FR") : "—"
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/super-admin/organizations">
                <ArrowLeft className="size-4" />
                Liste
              </Link>
            </Button>
            <Button size="sm" onClick={enterOrg} disabled={busy}>
              <ArrowRight className="size-4" />
              Entrer
            </Button>
            <Button variant="outline" size="sm" onClick={toggleStatus} disabled={busy}>
              {org.status === "active" ? (
                <>
                  <PauseCircle className="size-4" />
                  Suspendre
                </>
              ) : (
                <>
                  <PlayCircle className="size-4" />
                  {org.status === "invited" ? "Activer" : "Réactiver"}
                </>
              )}
            </Button>
            <Button variant="destructive" size="sm" onClick={deleteOrg} disabled={busy}>
              <Trash2 className="size-4" />
              Supprimer
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-2">
        <Badge
          variant={
            org.status === "active" ? "success" : org.status === "invited" ? "secondary" : "warning"
          }
        >
          {org.status === "invited" ? "invitée" : org.status}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {org.members_count ?? members.filter((m) => m.status === "active").length} membres ·{" "}
          {org.documents_count ?? 0} docs · {org.assistants_count ?? 0} assistants
        </span>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold">Usage vs quotas</h3>
          <div className="space-y-4">
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune donnée.</p>
            ) : (
              items.map((item) => <QuotaBar key={item.key} item={item} />)
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border p-4">
          <h3 className="mb-4 text-sm font-semibold">Modifier les quotas</h3>
          <form onSubmit={saveQuotas} className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["max_members", "Max membres"],
                ["max_documents", "Max documents"],
                ["max_assistants", "Max assistants"],
                ["max_knowledge_bases", "Max KB"],
                ["max_storage_gb", "Max stockage (Go)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min={0}
                  value={quotaForm[key]}
                  onChange={(e) =>
                    setQuotaForm({ ...quotaForm, [key]: Number(e.target.value) })
                  }
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={savingQuotas}>
                {savingQuotas ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Enregistrer
              </Button>
            </div>
          </form>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Membres</h3>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" />
            Inviter
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Aucun membre
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">{m.user?.full_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{m.user?.email}</div>
                    </TableCell>
                    <TableCell>{m.role?.code || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={m.status === "active" ? "success" : "secondary"}>
                        {m.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Invitations</h3>
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Expire</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Aucune invitation
                  </TableCell>
                </TableRow>
              ) : (
                invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inv.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.expires_at
                        ? new Date(inv.expires_at).toLocaleDateString("fr-FR")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <AppModal
        open={inviteOpen}
        onClose={() => !inviting && setInviteOpen(false)}
        labelledBy="invite-title"
      >
        <h2 id="invite-title" className="text-lg font-semibold">
          Inviter un utilisateur
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Un token est renvoyé une fois (email provider plus tard).
        </p>
        <form onSubmit={sendInvite} className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Rôle</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="org_member">User (membre)</option>
              <option value="org_admin">Admin (organisation)</option>
            </select>
          </div>
          {lastInviteToken ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs break-all">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium">Token</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToken(lastInviteToken)}
                >
                  <Copy className="size-3.5" />
                  Copier
                </Button>
              </div>
              {lastInviteToken}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Fermer
            </Button>
            <Button type="submit" disabled={inviting}>
              {inviting ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
            </Button>
          </div>
        </form>
      </AppModal>
    </DashboardShell>
  );
}
