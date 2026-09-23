"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Eye, Loader2, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { DocumentItem, KnowledgeBase } from "@/lib/types";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import {
  EditDocumentModal,
  type EditDocumentMeta,
} from "@/components/documents/edit-document-modal";
import {
  UploadDocumentModal,
  type UploadDocumentMeta,
} from "@/components/documents/upload-document-modal";
import { ViewDocumentModal } from "@/components/documents/view-document-modal";
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

const statusVariant: Record<string, "success" | "warning" | "secondary" | "danger" | "outline"> = {
  indexed: "success",
  processing: "warning",
  pending: "secondary",
  failed: "danger",
};

export default function DocumentsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kbId, setKbId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<DocumentItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [d, k] = await Promise.all([
      api.get<DocumentItem[]>("/api/documents"),
      api.get<KnowledgeBase[]>("/api/knowledge-bases"),
    ]);
    setDocs(d.data || []);
    setKbs(k.data || []);
  };

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
    const t = setInterval(() => load().catch(() => null), 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter !== "all" && d.status !== filter) return false;
      if (!q) return true;
      return d.name.toLowerCase().includes(q);
    });
  }, [docs, query, filter]);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    if (!pendingFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      if (kbId) fd.append("knowledge_base_id", kbId);
      fd.append("name", meta.name);
      if (meta.cloud_url) fd.append("cloud_url", meta.cloud_url);
      if (meta.source_url) fd.append("source_url", meta.source_url);
      await api.upload("/api/documents", fd);
      toast.success("Document uploadé");
      setModalOpen(false);
      setPendingFile(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur upload");
    } finally {
      setUploading(false);
    }
  };

  const openView = (doc: DocumentItem) => {
    setEditOpen(false);
    setActiveDoc(doc);
    setViewOpen(true);
  };

  const openEdit = (doc: DocumentItem) => {
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
      await api.patch(`/api/documents/${activeDoc.id}`, meta);
      toast.success("Document mis à jour");
      setEditOpen(false);
      setActiveDoc(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce document ?")) return;
    setBusyId(id);
    try {
      await api.delete(`/api/documents/${id}`);
      toast.success("Document supprimé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Documents" breadcrumbs={["Organisation", "Documents"]}>
      <PageHeader
        description="Uploadez et suivez l’indexation de vos fichiers."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={kbId}
              onChange={(e) => setKbId(e.target.value)}
            >
              <option value="">KB — aucune</option>
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
              onChange={onPickFile}
            />
            <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Uploader
            </Button>
          </div>
        }
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Nom du fichier…"
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
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucun document" description="Uploadez un PDF, DOCX, TXT ou XLSX." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Taille</TableHead>
                <TableHead>Statut</TableHead>
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
                  <TableCell className="text-muted-foreground">
                    {formatBytes(d.size_bytes)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[d.status] || "outline"}>{d.status}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {d.created_at ? new Date(d.created_at).toLocaleString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" disabled={busyId === d.id}>
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
        detailPath={activeDoc ? `/api/documents/${activeDoc.id}` : null}
        onClose={() => {
          setViewOpen(false);
          setActiveDoc(null);
        }}
      />
    </DashboardShell>
  );
}
