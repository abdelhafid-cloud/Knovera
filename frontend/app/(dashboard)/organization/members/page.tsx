"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Plus, Trash2, UserX } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { api } from "@/lib/api";
import type { Membership, User } from "@/lib/types";
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

type MemberRow = Membership & { user?: User | null };

export default function MembersPage() {
  const { organization } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    role_code: "org_member",
  });

  const load = async () => {
    if (!organization?.id) return;
    const res = await api.get<MemberRow[]>(`/api/organizations/${organization.id}/members`);
    setMembers(res.data || []);
  };

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [organization?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (filter !== "all" && m.status !== filter) return false;
      if (!q) return true;
      return (
        (m.user?.full_name || "").toLowerCase().includes(q) ||
        (m.user?.email || "").toLowerCase().includes(q) ||
        (m.role?.code || "").toLowerCase().includes(q)
      );
    });
  }, [members, query, filter]);

  const createMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization?.id) return;
    setCreating(true);
    try {
      await api.post(`/api/organizations/${organization.id}/members`, form);
      toast.success("Utilisateur ajouté");
      setForm({
        email: "",
        password: "",
        first_name: "",
        last_name: "",
        role_code: "org_member",
      });
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (m: MemberRow, status: "active" | "disabled") => {
    if (!organization?.id) return;
    setBusyId(m.id);
    try {
      await api.patch(`/api/organizations/${organization.id}/members/${m.id}`, { status });
      toast.success(status === "active" ? "Membre réactivé" : "Membre désactivé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (m: MemberRow) => {
    if (!organization?.id || !confirm("Retirer ce membre ?")) return;
    setBusyId(m.id);
    try {
      await api.delete(`/api/organizations/${organization.id}/members/${m.id}`);
      toast.success("Membre retiré");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Membres" breadcrumbs={["Organisation", "Membres"]}>
      <PageHeader
        description="Seul un Admin organisation peut ajouter des utilisateurs (Admin organisation ou User)."
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
        searchPlaceholder="Nom, email, rôle…"
        filters={[
          { value: "all", label: "Tous" },
          { value: "active", label: "Actifs" },
          { value: "disabled", label: "Désactivés" },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
        countLabel={`${filtered.length} / ${members.length}`}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucun membre" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.user?.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{m.user?.email}</div>
                  </TableCell>
                  <TableCell>
                    {m.role?.code === "org_admin"
                      ? "Admin organisation"
                      : m.role?.code === "org_member"
                        ? "User"
                        : m.role?.name || m.role?.code}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.status === "active" ? "success" : "warning"}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" disabled={busyId === m.id}>
                          {busyId === m.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {m.status === "active" ? (
                          <DropdownMenuItem onClick={() => setStatus(m, "disabled")}>
                            <UserX className="size-4" />
                            Désactiver
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => setStatus(m, "active")}>
                            Réactiver
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => remove(m)}
                        >
                          <Trash2 className="size-4" />
                          Retirer
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

      <AppModal open={createOpen} onClose={() => !creating && setCreateOpen(false)} labelledBy="create-member-title">
        <h2 id="create-member-title" className="text-lg font-semibold">
          Ajouter un utilisateur
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Le premier membre de l’organisation devient Admin organisation automatiquement.
        </p>
        <form onSubmit={createMember} className="mt-4 space-y-3">
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
            <Label>Type</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.role_code}
              onChange={(e) => setForm({ ...form, role_code: e.target.value })}
            >
              <option value="org_member">User</option>
              <option value="org_admin">Admin organisation</option>
            </select>
          </div>
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
