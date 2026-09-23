"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Eye, Loader2, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { DocumentItem, KnowledgeBase, Organization } from "@/lib/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableToolbar } from "@/components/ui/table-toolbar";
import { formatBytes } from "@/lib/utils";
import {
  EditDocumentModal,
  type EditDocumentMeta,
} from "@/components/documents/edit-document-modal";
import {
  UploadDocumentModal,
  type UploadDocumentMeta,
} from "@/components/documents/upload-document-modal";
import { ViewDocumentModal } from "@/components/documents/view-document-modal";

type PlatformDocument = DocumentItem & { organization_name?: string | null };

type WorkspacePayload = {
  organization: Organization;
  default_knowledge_base_id: string;
  knowledge_bases: KnowledgeBase[];
};

const statusVariant: Record<string, "success" | "warning" | "secondary" | "danger" | "outline"> = {
  indexed: "success",
  processing: "warning",
  pending: "secondary",
  failed: "danger",
};

async function withOrgContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const previous = api.organizationId;
  api.setOrganizationId(orgId);
  try {
    return await fn();
  } finally {
    api.setOrganizationId(previous);
  }
}

export default function PlatformDocumentsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<PlatformDocument[]>([]);
  const [workspace, setWorkspace] = useState<Organization | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [targetOrgId, setTargetOrgId] = useState("");
  const [kbId, setKbId] = useState("");
  const [scope, setScope] = useState<"workspace" | "all">("workspace");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [kbsReady, setKbsReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<PlatformDocument | null>(null);
  const [saving, setSaving] = useState(false);

  const isOwnWorkspace = !!workspace && targetOrgId === workspace.id;

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

  const loadDocs = useCallback(async () => {
    const r = await api.get<PlatformDocument[]>(`/api/admin/documents?scope=${scope}`);
    setDocs(r.data || []);
  }, [scope]);

  const loadKbsForOrg = useCallback(async (orgId: string, preferredKbId?: string) => {
    if (!orgId) {
      setKbs([]);
      setKbId("");
      return;
    }
    if (workspace && orgId === workspace.id) {
      const r = await api.get<WorkspacePayload>("/api/admin/workspace");
      setKbs(r.data.knowledge_bases || []);
      setKbId(
        preferredKbId || r.data.default_knowledge_base_id || r.data.knowledge_bases?.[0]?.id || ""
      );
      return;
    }
    const r = await withOrgContext(orgId, () => api.get<KnowledgeBase[]>("/api/knowledge-bases"));
    const list = r.data || [];
    setKbs(list);
    setKbId(preferredKbId || list[0]?.id || "");
  }, [workspace]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadWorkspace(), loadOrgs(), loadDocs()])
      .catch((e: Error) => toast.error(e.message))
      .finally(() => {
        setLoading(false);
        setKbsReady(true);
      });
  }, [loadWorkspace, loadOrgs, loadDocs]);

  useEffect(() => {
    const t = setInterval(() => loadDocs().catch(() => null), 5000);
    return () => clearInterval(t);
  }, [loadDocs]);

  useEffect(() => {
    if (!kbsReady || !targetOrgId) return;
    loadKbsForOrg(targetOrgId).catch((e: Error) => toast.error(e.message));
  }, [targetOrgId, kbsReady, loadKbsForOrg]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter !== "all" && d.status !== filter) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.organization_name || "").toLowerCase().includes(q)
      );
    });
  }, [docs, query, filter]);

  const uploadTargets = useMemo(() => {
    if (!workspace) return orgs;
    const others = orgs.filter((o) => o.id !== workspace.id);
    return [workspace, ...others];
  }, [orgs, workspace]);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!targetOrgId) {
      toast.error("Choisissez un espace / organisation");
      e.target.value = "";
      return;
    }
    setPendingFile(file);
    setModalOpen(true);
    e.target.value = "";
  };

  const closeModal = () => {
    if (uploading) return;
    setModalOpen(false);
    setPendingFile(null);
  };

  const confirmUpload = async (meta: UploadDocumentMeta) => {
    if (!pendingFile || !targetOrgId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      fd.append("organization_id", targetOrgId);
      if (kbId) fd.append("knowledge_base_id", kbId);
      fd.append("name", meta.name);
      if (meta.cloud_url) fd.append("cloud_url", meta.cloud_url);
      if (meta.source_url) fd.append("source_url", meta.source_url);
      await api.upload("/api/admin/documents", fd);
      const targetName =
        uploadTargets.find((o) => o.id === targetOrgId)?.name || "l’espace sélectionné";
      toast.success(`Document uploadé dans « ${targetName} »`);
      setModalOpen(false);
      setPendingFile(null);
      if (isOwnWorkspace) {
        if (scope !== "workspace") setScope("workspace");
        else await loadDocs();
      } else {
        if (scope !== "all") setScope("all");
        else await loadDocs();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur upload");
    } finally {
      setUploading(false);
    }
  };

  const openView = (doc: PlatformDocument) => {
    setEditOpen(false);
    setActiveDoc(doc);
    setViewOpen(true);
  };

  const openEdit = (doc: PlatformDocument) => {
    setViewOpen(false);
    setActiveDoc(doc);
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditOpen(false);
    setActiveDoc(null);
  };

  const confirmEdit = async (meta: EditDocumentMeta) => {
    if (!activeDoc) return;
    setSaving(true);
    try {
      await api.patch(`/api/admin/documents/${activeDoc.id}`, meta);
      toast.success("Document mis à jour");
      setEditOpen(false);
      setActiveDoc(null);
      await loadDocs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce document ? Les points Qdrant associés seront aussi purgés.")) return;
    setBusyId(id);
    try {
      await api.delete(`/api/admin/documents/${id}`);
      toast.success("Document supprimé");
      await loadDocs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Documents" breadcrumbs={["Super Admin", "Documents"]}>
      <PageHeader
        description="Uploadez dans votre espace ou dans l’espace d’une autre organisation."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="flex h-9 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm"
              value={targetOrgId}
              onChange={(e) => setTargetOrgId(e.target.value)}
            >
              {uploadTargets.map((org) => (
                <option key={org.id} value={org.id}>
                  {workspace && org.id === workspace.id
                    ? `Mon espace — ${org.name.replace(/^Mon espace — /, "")}`
                    : org.name}
                </option>
              ))}
            </select>
            <select
              className="flex h-9 max-w-[180px] rounded-md border border-input bg-background px-3 text-sm"
              value={kbId}
              onChange={(e) => setKbId(e.target.value)}
              disabled={!targetOrgId}
            >
              {kbs.length === 0 ? <option value="">Aucune KB</option> : null}
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.xlsx"
              onChange={onUpload}
            />
            <Button
              disabled={uploading || !targetOrgId}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {isOwnWorkspace ? "Uploader dans mon espace" : "Uploader ici"}
            </Button>
          </div>
        }
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Nom ou organisation…"
        filters={[
          { value: "all", label: "Tous" },
          { value: "indexed", label: "Indexés" },
          { value: "processing", label: "En cours" },
          { value: "pending", label: "En attente" },
          { value: "failed", label: "Échecs" },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
        countLabel={`${filtered.length} / ${docs.length}`}
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
              title="Aucun document"
              description="Choisissez un espace puis uploadez un PDF, DOCX, TXT ou XLSX."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                {scope === "all" ? <TableHead>Organisation</TableHead> : null}
                <TableHead>Statut</TableHead>
                <TableHead>Taille</TableHead>
                <TableHead>Créé</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    {(d.cloud_url || d.source_url) && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        {d.cloud_url ? (
                          <a
                            href={d.cloud_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground underline-offset-2 hover:underline"
                          >
                            Cloud
                          </a>
                        ) : null}
                        {d.source_url ? (
                          <a
                            href={d.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground underline-offset-2 hover:underline"
                          >
                            Source
                          </a>
                        ) : null}
                      </div>
                    )}
                    {d.error_message ? (
                      <div className="mt-1 text-xs text-destructive">{d.error_message}</div>
                    ) : null}
                  </TableCell>
                  {scope === "all" ? (
                    <TableCell className="text-muted-foreground">
                      {d.organization_name || "—"}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Badge variant={statusVariant[d.status] || "outline"}>{d.status}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatBytes(d.size_bytes)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {d.created_at ? new Date(d.created_at).toLocaleString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={busyId === d.id}
                        >
                          {busyId === d.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openView(d)}>
                          <Eye className="size-4" />
                          Visualiser
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(d)}>
                          <Pencil className="size-4" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => remove(d.id)}
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
      <UploadDocumentModal
        open={modalOpen}
        file={pendingFile}
        uploading={uploading}
        onClose={closeModal}
        onConfirm={confirmUpload}
      />
      <EditDocumentModal
        open={editOpen}
        document={activeDoc}
        saving={saving}
        onClose={closeEdit}
        onConfirm={confirmEdit}
      />
      <ViewDocumentModal
        open={viewOpen}
        document={activeDoc}
        detailPath={activeDoc ? `/api/admin/documents/${activeDoc.id}` : null}
        onClose={() => {
          setViewOpen(false);
          setActiveDoc(null);
        }}
      />
    </DashboardShell>
  );
}
