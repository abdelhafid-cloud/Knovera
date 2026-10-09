"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Database, Eye, HardDrive, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { KbProvisioningPreview, KnowledgeBase, Organization } from "@/lib/types";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  CollectionBadge,
  MinioBucketBadge,
  VectorDbBadge,
} from "@/components/ui/storage-badges";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

type PlatformKB = KnowledgeBase & { organization_name?: string | null };

type WorkspacePayload = {
  organization: Organization;
  default_knowledge_base_id: string;
  knowledge_bases: KnowledgeBase[];
};

export default function PlatformKnowledgeBasesPage() {
  const [items, setItems] = useState<PlatformKB[]>([]);
  const [workspace, setWorkspace] = useState<Organization | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [scope, setScope] = useState<"workspace" | "all">("workspace");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetOrgId, setTargetOrgId] = useState("");
  const [preview, setPreview] = useState<KbProvisioningPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [viewKb, setViewKb] = useState<PlatformKB | null>(null);
  const [editKb, setEditKb] = useState<PlatformKB | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadWorkspace = useCallback(async () => {
    const r = await api.get<WorkspacePayload>("/api/admin/workspace");
    setWorkspace(r.data.organization);
    setTargetOrgId((current) => current || r.data.organization.id);
    return r.data;
  }, []);

  const loadOrgs = useCallback(async () => {
    const r = await api.get<Organization[]>("/api/organizations?include_workspace=1");
    setOrgs((r.data || []).filter((o) => o.status === "active"));
  }, []);

  const loadKbs = useCallback(async () => {
    const r = await api.get<PlatformKB[]>(`/api/admin/knowledge-bases?scope=${scope}`);
    setItems(r.data || []);
  }, [scope]);

  const loadPreview = useCallback(async (orgId: string) => {
    if (!orgId) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const r = await api.get<KbProvisioningPreview>(
        `/api/admin/knowledge-bases/provisioning-preview?organization_id=${encodeURIComponent(orgId)}`
      );
      setPreview(r.data);
    } catch (e) {
      setPreview(null);
      toast.error(e instanceof Error ? e.message : "Aperçu stockage indisponible");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadWorkspace(), loadOrgs(), loadKbs()])
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [loadWorkspace, loadOrgs, loadKbs]);

  useEffect(() => {
    if (createOpen && targetOrgId) {
      void loadPreview(targetOrgId);
    }
  }, [createOpen, targetOrgId, loadPreview]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((kb) => {
      if (!q) return true;
      return (
        kb.name.toLowerCase().includes(q) ||
        (kb.description || "").toLowerCase().includes(q) ||
        (kb.organization_name || "").toLowerCase().includes(q) ||
        (kb.qdrant_collection || "").toLowerCase().includes(q) ||
        (kb.minio_bucket || "").toLowerCase().includes(q)
      );
    });
  }, [items, query]);

  const uploadTargets = useMemo(() => {
    if (!workspace) return orgs;
    const others = orgs.filter((o) => o.id !== workspace.id);
    return [workspace, ...others];
  }, [orgs, workspace]);

  const openCreate = () => {
    setName("");
    setDescription("");
    setTargetOrgId(workspace?.id || targetOrgId || "");
    setPreview(null);
    setCreateOpen(true);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!targetOrgId || !name.trim()) {
      toast.error("Organisation et nom requis");
      return;
    }
    setCreating(true);
    try {
      await api.post("/api/admin/knowledge-bases", {
        organization_id: targetOrgId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.success(
        preview
          ? `KB créée — ${preview.vector_db_label} · ${preview.qdrant_collection}`
          : "Knowledge base créée"
      );
      setCreateOpen(false);
      const isOwn = workspace && targetOrgId === workspace.id;
      if (isOwn) {
        if (scope !== "workspace") setScope("workspace");
        else await loadKbs();
      } else {
        if (scope !== "all") setScope("all");
        else await loadKbs();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (kb: PlatformKB) => {
    setEditKb(kb);
    setEditName(kb.name);
    setEditDescription(kb.description || "");
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editKb || !editName.trim()) return;
    setSavingEdit(true);
    try {
      await api.patch(`/api/admin/knowledge-bases/${editKb.id}`, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      toast.success("Knowledge base mise à jour");
      setEditKb(null);
      await loadKbs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (id: string) => {
    if (
      !confirm(
        "Supprimer cette knowledge base ? Les documents liés, leur collection Qdrant et les assistants associés seront aussi supprimés."
      )
    )
      return;
    setBusyId(id);
    try {
      const r = await api.delete<{
        ok?: boolean;
        documents_deleted?: number;
        assistants_deleted?: number;
      }>(`/api/admin/knowledge-bases/${id}`);
      const docs = r.data?.documents_deleted ?? 0;
      const asst = r.data?.assistants_deleted ?? 0;
      toast.success(`KB supprimée (${docs} doc(s), ${asst} assistant(s))`);
      await loadKbs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Knowledge bases" breadcrumbs={["Super Admin", "Knowledge bases"]}>
      <PageHeader
        description="Chaque KB provisionne une collection Qdrant et utilise le bucket MinIO de l’organisation."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Ajouter
          </Button>
        }
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Nom, collection, bucket…"
        countLabel={`${filtered.length} / ${items.length}`}
      />
      <div className="mb-3 flex gap-2">
        <Button
          size="sm"
          variant={scope === "workspace" ? "default" : "outline"}
          onClick={() => setScope("workspace")}
        >
          Mon espace
        </Button>
        <Button
          size="sm"
          variant={scope === "all" ? "default" : "outline"}
          onClick={() => setScope("all")}
        >
          Toute la plateforme
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Aucune knowledge base"
              description="Créez une KB (ex. RH, Finance) pour isoler documents, collection et bucket."
              action={
                <Button onClick={openCreate}>
                  <Plus className="size-4" />
                  Ajouter
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                {scope === "all" ? <TableHead>Organisation</TableHead> : null}
                <TableHead>Collection</TableHead>
                <TableHead>Nom Qdrant</TableHead>
                <TableHead>Bucket MinIO</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Créée</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((kb) => (
                <TableRow key={kb.id}>
                  <TableCell>
                    <div className="font-medium">{kb.name}</div>
                    {kb.description ? (
                      <div className="text-xs text-muted-foreground">{kb.description}</div>
                    ) : null}
                  </TableCell>
                  {scope === "all" ? (
                    <TableCell className="text-muted-foreground">
                      {kb.organization_name || "—"}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <VectorDbBadge number={kb.vector_db_number} label={kb.vector_db_label} />
                  </TableCell>
                  <TableCell>
                    <CollectionBadge name={kb.qdrant_collection} />
                  </TableCell>
                  <TableCell>
                    <MinioBucketBadge bucket={kb.minio_bucket} />
                  </TableCell>
                  <TableCell className="tabular-nums">{kb.document_count ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {kb.created_at ? new Date(kb.created_at).toLocaleDateString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={busyId === kb.id}
                        >
                          {busyId === kb.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setViewKb(kb)}>
                          <Eye className="size-4" />
                          Afficher
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(kb)}>
                          <Pencil className="size-4" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => remove(kb.id)}
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

      <AppModal open={!!viewKb} onClose={() => setViewKb(null)} labelledBy="view-kb-title">
        {viewKb ? (
          <div className="space-y-4">
            <h2 id="view-kb-title" className="text-lg font-semibold">
              Afficher la knowledge base
            </h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Nom</dt>
                <dd className="font-medium">{viewKb.name}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Description</dt>
                <dd>{viewKb.description || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Organisation</dt>
                <dd>{viewKb.organization_name || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Documents</dt>
                <dd>{viewKb.document_count ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Collection</dt>
                <dd>
                  <VectorDbBadge number={viewKb.vector_db_number} label={viewKb.vector_db_label} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nom Qdrant</dt>
                <dd>
                  <CollectionBadge name={viewKb.qdrant_collection} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bucket MinIO</dt>
                <dd>
                  <MinioBucketBadge bucket={viewKb.minio_bucket} />
                </dd>
              </div>
            </dl>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setViewKb(null)}>
                Fermer
              </Button>
              <Button
                type="button"
                onClick={() => {
                  openEdit(viewKb);
                  setViewKb(null);
                }}
              >
                Modifier
              </Button>
            </div>
          </div>
        ) : null}
      </AppModal>

      <AppModal
        open={!!editKb}
        onClose={() => !savingEdit && setEditKb(null)}
        labelledBy="edit-kb-title"
      >
        <h2 id="edit-kb-title" className="text-lg font-semibold">
          Modifier la knowledge base
        </h2>
        <form onSubmit={saveEdit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Thème / périmètre documentaire"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditKb(null)} disabled={savingEdit}>
              Annuler
            </Button>
            <Button type="submit" disabled={savingEdit}>
              {savingEdit ? <Loader2 className="size-4 animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </form>
      </AppModal>

      <AppModal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        labelledBy="create-sa-kb-title"
      >
        <h2 id="create-sa-kb-title" className="text-lg font-semibold">
          Nouvelle knowledge base
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Une collection Qdrant dédiée sera créée ; les fichiers iront dans le bucket MinIO de l’org.
        </p>
        <form onSubmit={create} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Espace / organisation</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={targetOrgId}
              onChange={(e) => setTargetOrgId(e.target.value)}
              required
            >
              {uploadTargets.map((org) => (
                <option key={org.id} value={org.id}>
                  {workspace && org.id === workspace.id
                    ? `Mon espace — ${org.name.replace(/^Mon espace — /, "")}`
                    : org.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Database className="size-3.5" />
                Nouvelle collection
              </div>
              {previewLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <VectorDbBadge
                  number={preview?.next_vector_db_number}
                  label={preview?.vector_db_label}
                />
              )}
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {preview?.qdrant_collection || "collection Qdrant…"}
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-card to-card p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-sky-800 dark:text-sky-300">
                <HardDrive className="size-3.5" />
                Bucket MinIO (org)
              </div>
              {previewLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <MinioBucketBadge bucket={preview?.minio_bucket} />
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge variant="info" className="text-[10px]">
                  Partagé
                </Badge>
                toutes les KB de l’org
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Nom</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. RH, Finance, Support…"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Thème / périmètre documentaire"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Annuler
            </Button>
            <Button type="submit" disabled={creating || previewLoading}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
            </Button>
          </div>
        </form>
      </AppModal>
    </DashboardShell>
  );
}
