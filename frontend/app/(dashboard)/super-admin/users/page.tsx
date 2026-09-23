"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Loader2,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Assistant, Organization, User } from "@/lib/types";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableToolbar } from "@/components/ui/table-toolbar";
import { AppModal } from "@/components/ui/app-modal";

type EditForm = {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  is_active: boolean;
  is_super_admin: boolean;
};

function RoleCell({ user }: { user: User }) {
  if (user.is_super_admin) {
    return <span className="text-sm">Super Admin</span>;
  }
  const active = (user.memberships || []).filter((m) => m.status === "active");
  const admin = active.find((m) => m.role?.code === "org_admin");
  if (admin) {
    return (
      <div>
        <div className="text-sm font-medium">Admin organisation</div>
        {admin.organization_name ? (
          <div className="text-xs text-muted-foreground">{admin.organization_name}</div>
        ) : null}
      </div>
    );
  }
  const member = active.find((m) => m.role?.code === "org_member") || active[0];
  if (member) {
    return (
      <div>
        <div className="text-sm">User</div>
        {member.organization_name ? (
          <div className="text-xs text-muted-foreground">{member.organization_name}</div>
        ) : null}
      </div>
    );
  }
  return <span className="text-sm text-muted-foreground">—</span>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [orgAssistants, setOrgAssistants] = useState<Assistant[]>([]);
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    organization_id: "",
    role_code: "org_member",
    assistant_ids: [] as string[],
  });

  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    is_active: true,
    is_super_admin: false,
  });
  const [saving, setSaving] = useState(false);

  const [resetInfo, setResetInfo] = useState<{
    email: string;
    reset_url: string;
    token: string;
  } | null>(null);

  const load = async () => {
    const [u, o] = await Promise.all([
      api.get<User[]>("/api/admin/users"),
      api.get<Organization[]>("/api/organizations?include_workspace=1"),
    ]);
    setUsers(u.data || []);
    setOrgs(o.data || []);
  };

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!createOpen || !form.organization_id || form.role_code !== "org_member") {
      setOrgAssistants([]);
      return;
    }
    let cancelled = false;
    setLoadingAssistants(true);
    api
      .get<Assistant[]>(`/api/admin/assistants?organization_id=${form.organization_id}`)
      .then((r) => {
        if (!cancelled) setOrgAssistants(r.data || []);
      })
      .catch(() => {
        if (!cancelled) setOrgAssistants([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssistants(false);
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, form.organization_id, form.role_code]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === "active" && !u.is_active) return false;
      if (filter === "inactive" && u.is_active) return false;
      if (filter === "admin" && !u.is_super_admin) return false;
      if (!q) return true;
      return (
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
      );
    });
  }, [users, query, filter]);

  const toggleAssistant = (id: string) => {
    setForm((prev) => {
      const has = prev.assistant_ids.includes(id);
      return {
        ...prev,
        assistant_ids: has
          ? prev.assistant_ids.filter((x) => x !== id)
          : [...prev.assistant_ids, id],
      };
    });
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditForm({
      first_name: u.first_name || "",
      last_name: u.last_name || "",
      email: u.email || "",
      password: "",
      is_active: !!u.is_active,
      is_super_admin: !!u.is_super_admin,
    });
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        email: editForm.email,
        is_active: editForm.is_active,
        is_super_admin: editForm.is_super_admin,
      };
      if (editForm.password.trim()) {
        payload.password = editForm.password;
      }
      await api.patch(`/api/admin/users/${editUser.id}`, payload);
      toast.success("Utilisateur modifié");
      setEditUser(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (u: User) => {
    if (!confirm(`Supprimer définitivement « ${u.full_name || u.email} » ?`)) return;
    setBusyId(u.id);
    try {
      await api.delete(`/api/admin/users/${u.id}`);
      toast.success("Utilisateur supprimé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (u: User) => {
    setBusyId(u.id);
    try {
      await api.patch(`/api/admin/users/${u.id}`, { is_active: !u.is_active });
      toast.success(u.is_active ? "Utilisateur désactivé" : "Utilisateur activé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (u: User) => {
    setBusyId(u.id);
    try {
      const r = await api.post<{ email: string; reset_url: string; token: string }>(
        `/api/admin/users/${u.id}/reset-password`
      );
      setResetInfo(r.data);
      toast.success("Lien de réinitialisation généré");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const payload = {
        ...form,
        assistant_ids:
          form.role_code === "org_member" ? form.assistant_ids : [],
      };
      await api.post("/api/admin/users", payload);
      toast.success(
        form.role_code === "org_admin"
          ? "Admin créé — accès à tous les assistants"
          : `Utilisateur créé — ${form.assistant_ids.length} assistant(s)`
      );
      setForm({
        email: "",
        password: "",
        first_name: "",
        last_name: "",
        organization_id: form.organization_id,
        role_code: "org_member",
        assistant_ids: [],
      });
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  return (
    <DashboardShell title="Utilisateurs" breadcrumbs={["Super Admin", "Utilisateurs"]}>
      <PageHeader
        description="Seuls le Super Admin et les Org Admin peuvent créer des comptes. Aucune inscription libre."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Ajouter
          </Button>
        }
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Nom ou email…"
        filters={[
          { value: "all", label: "Tous" },
          { value: "active", label: "Actifs" },
          { value: "inactive", label: "Inactifs" },
          { value: "admin", label: "Super Admin" },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
        countLabel={`${filtered.length} / ${users.length}`}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucun utilisateur" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Créé</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? "success" : "danger"}>
                      {u.is_active ? "actif" : "inactif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RoleCell user={u} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" disabled={busyId === u.id}>
                          {busyId === u.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(u)}>
                          <Pencil className="size-4" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleActive(u)}>
                          {u.is_active ? (
                            <>
                              <UserX className="size-4" />
                              Désactiver
                            </>
                          ) : (
                            <>
                              <UserCheck className="size-4" />
                              Activer
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => resetPassword(u)}>
                          <KeyRound className="size-4" />
                          Reset mot de passe
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => deleteUser(u)}
                        >
                          <Trash2 className="size-4" />
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AppModal open={!!editUser} onClose={() => !saving && setEditUser(null)} labelledBy="edit-user-title">
        <h2 id="edit-user-title" className="text-lg font-semibold">
          Modifier l’utilisateur
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{editUser?.email}</p>
        <form onSubmit={saveEdit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Prénom</Label>
              <Input
                value={editForm.first_name}
                onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input
                value={editForm.last_name}
                onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Nouveau mot de passe (optionnel)</Label>
            <Input
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              minLength={8}
              placeholder="Laisser vide pour ne pas changer"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editForm.is_active}
                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
              />
              Actif
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editForm.is_super_admin}
                onChange={(e) => setEditForm({ ...editForm, is_super_admin: e.target.checked })}
              />
              Super Admin
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </form>
      </AppModal>

      <AppModal open={!!resetInfo} onClose={() => setResetInfo(null)} labelledBy="reset-title">
        <h2 id="reset-title" className="text-lg font-semibold">
          Lien de réinitialisation
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Valable 60 minutes pour {resetInfo?.email}. Copiez le lien (pas d’email SMTP en MVP).
        </p>
        <div className="mt-4 space-y-2">
          <Label>URL</Label>
          <div className="break-all rounded-md border border-border bg-muted/40 p-3 text-xs">
            {resetInfo?.reset_url}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              if (resetInfo?.reset_url) {
                await navigator.clipboard.writeText(resetInfo.reset_url);
                toast.success("Lien copié");
              }
            }}
          >
            Copier le lien
          </Button>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => setResetInfo(null)}>
            Fermer
          </Button>
        </div>
      </AppModal>

      <AppModal open={createOpen} onClose={() => !creating && setCreateOpen(false)} labelledBy="create-user-title">
        <h2 id="create-user-title" className="text-lg font-semibold">
          Créer un utilisateur
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin org = tous les assistants. User = choisir les assistants autorisés.
        </p>
        <form onSubmit={createUser} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Prénom</Label>
              <Input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Mot de passe</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label>Organisation</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.organization_id}
              onChange={(e) =>
                setForm({ ...form, organization_id: e.target.value, assistant_ids: [] })
              }
              required
            >
              <option value="">Sélectionner…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.is_super_admin_workspace ? `${o.name} (mon espace)` : o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.role_code}
              onChange={(e) =>
                setForm({ ...form, role_code: e.target.value, assistant_ids: [] })
              }
            >
              <option value="org_member">User (membre)</option>
              <option value="org_admin">Admin (organisation)</option>
            </select>
          </div>

          {form.role_code === "org_admin" ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Accès automatique à <strong>tous</strong> les assistants de l’organisation.
            </div>
          ) : form.organization_id ? (
            <div className="space-y-2">
              <Label>Assistants autorisés</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {loadingAssistants ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : orgAssistants.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-muted-foreground">
                    Aucun assistant dans cette organisation.
                  </p>
                ) : (
                  orgAssistants.map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={form.assistant_ids.includes(a.id)}
                        onChange={() => toggleAssistant(a.id)}
                      />
                      <span className="truncate">{a.name}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {form.assistant_ids.length} sélectionné(s)
              </p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
            </Button>
          </div>
        </form>
      </AppModal>
    </DashboardShell>
  );
}
