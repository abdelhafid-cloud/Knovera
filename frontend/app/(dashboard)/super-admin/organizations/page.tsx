"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  Eye,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Organization } from "@/lib/types";
import { useAuth } from "@/components/providers/auth-provider";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import { OrganizationFicheDrawer } from "@/components/organizations/organization-fiche-drawer";
import { OrgLogo } from "@/components/organizations/org-logo";
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
import { TableToolbar } from "@/components/ui/table-toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppModal } from "@/components/ui/app-modal";

type StatusFilter = "all" | "active" | "invited" | "suspended";

export default function OrganizationsPage() {
  const router = useRouter();
  const { switchOrganization } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [maxMembers, setMaxMembers] = useState("50");
  const [maxDocuments, setMaxDocuments] = useState("500");
  const [maxAssistants, setMaxAssistants] = useState("20");
  const [maxKnowledgeBases, setMaxKnowledgeBases] = useState("20");
  const [maxStorageGb, setMaxStorageGb] = useState("5");
  const [creating, setCreating] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ficheOpen, setFicheOpen] = useState(false);
  const [ficheOrgId, setFicheOrgId] = useState<string | null>(null);

  const load = async () => {
    const r = await api.get<Organization[]>("/api/organizations");
    setOrgs(r.data || []);
  };

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orgs.filter((org) => {
      if (statusFilter !== "all" && org.status !== statusFilter) return false;
      if (!q) return true;
      return (
        org.name.toLowerCase().includes(q) ||
        org.slug.toLowerCase().includes(q)
      );
    });
  }, [orgs, query, statusFilter]);

  const openFiche = (org: Organization) => {
    setFicheOrgId(org.id);
    setFicheOpen(true);
  };

  const resetCreateForm = () => {
    setName("");
    setAdminFirstName("");
    setAdminLastName("");
    setAdminEmail("");
    setMaxMembers("50");
    setMaxDocuments("500");
    setMaxAssistants("20");
    setMaxKnowledgeBases("20");
    setMaxStorageGb("5");
    setLogoFile(null);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const onLogoSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choisissez une image (PNG, JPG, WEBP)");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Logo trop lourd (max 5 Mo)");
      return;
    }
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const clearLogo = () => {
    setLogoFile(null);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const createOrg = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const storageBytes = Math.max(0, Number(maxStorageGb) || 0) * 1024 * 1024 * 1024;
      const r = await api.post<{
        id?: string;
        emails?: { invitation_sent?: boolean; admin_invited?: string };
      }>("/api/organizations", {
        name,
        admin_email: adminEmail || undefined,
        admin_first_name: adminFirstName || undefined,
        admin_last_name: adminLastName || undefined,
        quotas: {
          max_members: Number(maxMembers) || 0,
          max_documents: Number(maxDocuments) || 0,
          max_assistants: Number(maxAssistants) || 0,
          max_knowledge_bases: Number(maxKnowledgeBases) || 0,
          max_storage_bytes: storageBytes,
        },
      });
      if (logoFile && r.data?.id) {
        const fd = new FormData();
        fd.append("logo", logoFile);
        await api.upload(`/api/organizations/${r.data.id}/logo`, fd);
      }
      if (r.data?.emails?.invitation_sent) {
        toast.success(`Organisation créée — invitation envoyée à ${r.data.emails.admin_invited}`);
      } else if (adminEmail) {
        toast.success("Organisation créée — emails envoyés");
      } else {
        toast.success("Organisation créée");
      }
      resetCreateForm();
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const enterOrg = async (org: Organization) => {
    setBusyId(org.id);
    try {
      await switchOrganization(org.id);
      router.push("/organization");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const suspendOrg = async (org: Organization) => {
    if (!confirm(`Suspendre « ${org.name} » ?`)) return;
    setBusyId(org.id);
    try {
      await api.post(`/api/organizations/${org.id}/suspend`);
      toast.success("Organisation suspendue");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const activateOrg = async (org: Organization) => {
    setBusyId(org.id);
    try {
      await api.post(`/api/organizations/${org.id}/activate`);
      toast.success("Organisation réactivée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const deleteOrg = async (org: Organization) => {
    if (!confirm(`Supprimer définitivement « ${org.name} » ?`)) return;
    setBusyId(org.id);
    try {
      await api.delete(`/api/organizations/${org.id}`);
      toast.success("Organisation supprimée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Organisations" breadcrumbs={["Super Admin", "Organisations"]}>
      <PageHeader
        description="Gérez tous les tenants de la plateforme."
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
        searchPlaceholder="Rechercher nom ou slug…"
        filters={[
          { value: "all", label: "Tous" },
          { value: "active", label: "Actives" },
          { value: "invited", label: "Invitées" },
          { value: "suspended", label: "Suspendues" },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(v) => setStatusFilter(v as StatusFilter)}
        countLabel={`${filtered.length} / ${orgs.length}`}
      />

      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Chargement…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={orgs.length === 0 ? "Aucune organisation" : "Aucun résultat"}
              description={
                orgs.length === 0
                  ? "Cliquez sur Ajouter pour créer le premier tenant."
                  : "Modifiez la recherche ou les filtres."
              }
              action={
                orgs.length === 0 ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" />
                    Ajouter
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Membres</TableHead>
                <TableHead className="text-right">Docs</TableHead>
                <TableHead className="text-right">Assistants</TableHead>
                <TableHead className="text-right">Chats</TableHead>
                <TableHead>Créée</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <OrgLogo name={org.name} logoUrl={org.logo_url} className="size-9 rounded-lg" />
                      <div>
                        <div className="font-medium">{org.name}</div>
                        <div className="text-xs text-muted-foreground">{org.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        org.status === "active"
                          ? "success"
                          : org.status === "invited"
                            ? "secondary"
                            : "warning"
                      }
                    >
                      {org.status === "invited" ? "invitée" : org.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {org.members_count ?? "—"}
                    {org.quotas?.max_members != null ? (
                      <span className="text-muted-foreground">/{org.quotas.max_members}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {org.documents_count ?? "—"}
                    {org.quotas?.max_documents != null ? (
                      <span className="text-muted-foreground">/{org.quotas.max_documents}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {org.assistants_count ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {org.conversations_count ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {org.created_at
                      ? new Date(org.created_at).toLocaleDateString("fr-FR")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={busyId === org.id}
                          aria-label="Actions"
                        >
                          {busyId === org.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => openFiche(org)}>
                          <Eye className="size-4" />
                          Voir la fiche
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => enterOrg(org)}>
                          <ArrowRight className="size-4" />
                          Entrer dans l’org
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {org.status === "active" ? (
                          <DropdownMenuItem onClick={() => suspendOrg(org)}>
                            <PauseCircle className="size-4" />
                            Suspendre
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => activateOrg(org)}>
                            <PlayCircle className="size-4" />
                            {org.status === "invited" ? "Activer" : "Réactiver"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => deleteOrg(org)}
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

      <OrganizationFicheDrawer
        open={ficheOpen}
        organizationId={ficheOrgId}
        onClose={() => {
          setFicheOpen(false);
          setFicheOrgId(null);
        }}
        onChanged={() => {
          void load();
        }}
      />

      <AppModal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        labelledBy="create-org-title"
        className="max-h-[90vh] max-w-xl overflow-y-auto"
      >
        <h2 id="create-org-title" className="text-lg font-semibold tracking-tight">
          Nouvelle organisation
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Identité, logo, administrateur et quotas de départ.
        </p>
        <form onSubmit={createOrg} className="mt-5 space-y-5">
          <section className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Identité
            </p>
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex size-20 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-background hover:bg-muted/60"
                  aria-label="Choisir un logo"
                >
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoPreview} alt="" className="size-full object-cover" />
                  ) : (
                    <Building2 className="size-6 text-muted-foreground" />
                  )}
                </button>
                {logoPreview ? (
                  <button
                    type="button"
                    onClick={clearLogo}
                    className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                    aria-label="Retirer le logo"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={onLogoSelected}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="org-name">Nom</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Entreprise"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ImagePlus className="size-3.5" />
                  {logoFile ? logoFile.name : "Ajouter un logo (PNG, JPG, WEBP)"}
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Administrateur
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Une invitation est envoyée. L’administrateur choisit son mot de passe en acceptant.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="admin-first">Prénom</Label>
                <Input
                  id="admin-first"
                  value={adminFirstName}
                  onChange={(e) => setAdminFirstName(e.target.value)}
                  placeholder="Amina"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-last">Nom</Label>
                <Input
                  id="admin-last"
                  value={adminLastName}
                  onChange={(e) => setAdminLastName(e.target.value)}
                  placeholder="Benali"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@entreprise.com"
              />
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Quotas
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Limites de départ. Modifiables ensuite depuis la fiche.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="q-members">Membres max</Label>
                <Input
                  id="q-members"
                  type="number"
                  min={0}
                  value={maxMembers}
                  onChange={(e) => setMaxMembers(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="q-docs">Documents max</Label>
                <Input
                  id="q-docs"
                  type="number"
                  min={0}
                  value={maxDocuments}
                  onChange={(e) => setMaxDocuments(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="q-assistants">Assistants max</Label>
                <Input
                  id="q-assistants"
                  type="number"
                  min={0}
                  value={maxAssistants}
                  onChange={(e) => setMaxAssistants(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="q-kb">Knowledge bases max</Label>
                <Input
                  id="q-kb"
                  type="number"
                  min={0}
                  value={maxKnowledgeBases}
                  onChange={(e) => setMaxKnowledgeBases(e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="q-storage">Stockage max (Go)</Label>
                <Input
                  id="q-storage"
                  type="number"
                  min={0}
                  step="0.5"
                  value={maxStorageGb}
                  onChange={(e) => setMaxStorageGb(e.target.value)}
                />
              </div>
            </div>
          </section>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
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
