"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Database, HardDrive, ClipboardList, Loader2, MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { api } from "@/lib/api";
import type { KbProvisioningPreview, KnowledgeBase } from "@/lib/types";
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

export default function KnowledgeBasesPage() {
  const { isSuperAdmin } = useAuth();
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<KbProvisioningPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ragOpen, setRagOpen] = useState(false);
  const [ragKb, setRagKb] = useState<KnowledgeBase | null>(null);
  const [ragForm, setRagForm] = useState({ chunk_size: 800, overlap: 120, top_k: 5 });
  const [ragSaving, setRagSaving] = useState(false);

  const load = async () => {
    const r = await api.get<KnowledgeBase[]>("/api/knowledge-bases");
    setItems(r.data || []);
  };

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const r = await api.get<KbProvisioningPreview>("/api/knowledge-bases/provisioning-preview");
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
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (createOpen) void loadPreview();
  }, [createOpen, loadPreview]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (kb) =>
        kb.name.toLowerCase().includes(q) ||
        (kb.description || "").toLowerCase().includes(q) ||
        (kb.qdrant_collection || "").toLowerCase().includes(q) ||
        (kb.minio_bucket || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  const openCreate = () => {
    setName("");
    setDescription("");
    setPreview(null);
    setCreateOpen(true);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/api/knowledge-bases", { name, description });
      toast.success(
        preview
          ? `KB créée — ${preview.vector_db_label}`
          : "Knowledge base créée"
      );
      setName("");
      setDescription("");
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const openRag = (kb: KnowledgeBase) => {
    const rs = (kb.rag_settings || {}) as Record<string, unknown>;
    setRagKb(kb);
    setRagForm({
      chunk_size: Number(rs.chunk_size ?? 800),
      overlap: Number(rs.overlap ?? 120),
      top_k: Number(rs.top_k ?? 5),
    });
    setRagOpen(true);
  };

  const saveRag = async () => {
    if (!ragKb) return;
    setRagSaving(true);
    try {
      await api.patch(`/api/knowledge-bases/${ragKb.id}`, {
        rag_settings: {
          chunk_size: Number(ragForm.chunk_size),
          overlap: Number(ragForm.overlap),
          top_k: Number(ragForm.top_k),
        },
      });
      toast.success("Réglages RAG enregistrés");
      setRagOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setRagSaving(false);
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
        documents_deleted?: number;
        assistants_deleted?: number;
      }>(`/api/knowledge-bases/${id}`);
      const docs = r.data?.documents_deleted ?? 0;
      const asst = r.data?.assistants_deleted ?? 0;
      toast.success(`KB supprimée (${docs} doc(s), ${asst} assistant(s))`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Knowledge bases" breadcrumbs={["Organisation", "KB"]}>
      <PageHeader
        description={
          isSuperAdmin
            ? "Créez et gérez les knowledge bases (collection Qdrant, bucket MinIO de l’organisation)."
            : "Consultation des knowledge bases provisionnées par la plateforme (Super Admin)."
        }
        actions={
          isSuperAdmin ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Ajouter
            </Button>
          ) : undefined
        }
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Nom, collection…"
        countLabel={`${filtered.length} / ${items.length}`}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucune knowledge base" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead>Nom Qdrant</TableHead>
                <TableHead>Bucket MinIO</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Créée</TableHead>
                {isSuperAdmin ? (
                  <TableHead className="w-[70px] text-right">Actions</TableHead>
                ) : null}
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
                  <TableCell>
                    <VectorDbBadge number={kb.vector_db_number} label={kb.vector_db_label} />
                  </TableCell>
                  <TableCell>
                    <CollectionBadge name={kb.qdrant_collection} />
                  </TableCell>
                  <TableCell>
                    <MinioBucketBadge bucket={kb.minio_bucket} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {kb.document_count ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {kb.created_at ? new Date(kb.created_at).toLocaleDateString("fr-FR") : "—"}
                  </TableCell>
                  {isSuperAdmin ? (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" disabled={busyId === kb.id}>
                            {busyId === kb.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="size-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openRag(kb)}>
                            <Settings className="size-4" />
                            Réglages RAG
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/organization/knowledge-bases/${kb.id}/eval`}>
                              <ClipboardList className="size-4" />
                              Évaluation
                            </Link>
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
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AppModal open={createOpen} onClose={() => !creating && setCreateOpen(false)} labelledBy="create-kb-title">
        <h2 id="create-kb-title" className="text-lg font-semibold">
          Nouvelle knowledge base
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Le numéro de collection s’incrémente automatiquement pour votre organisation.
        </p>
        <form onSubmit={create} className="mt-4 space-y-4">
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
                Bucket MinIO
              </div>
              {previewLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <MinioBucketBadge bucket={preview?.minio_bucket} />
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge variant="info" className="text-[10px]">
                  Org
                </Badge>
                bucket partagé
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. RH, Finance…"
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
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={creating || previewLoading}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
            </Button>
          </div>
        </form>
      </AppModal>

      <AppModal
        open={ragOpen}
        onClose={() => !ragSaving && setRagOpen(false)}
        labelledBy="rag-kb-title"
        className="max-w-md"
      >
        <h2 id="rag-kb-title" className="text-lg font-semibold">
          Réglages RAG — {ragKb?.name}
        </h2>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Taille de chunk</Label>
            <Input
              type="number"
              min={100}
              value={ragForm.chunk_size}
              onChange={(e) => setRagForm({ ...ragForm, chunk_size: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Chevauchement (overlap)</Label>
            <Input
              type="number"
              min={0}
              value={ragForm.overlap}
              onChange={(e) => setRagForm({ ...ragForm, overlap: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Top K</Label>
            <Input
              type="number"
              min={1}
              value={ragForm.top_k}
              onChange={(e) => setRagForm({ ...ragForm, top_k: Number(e.target.value) })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRagOpen(false)}>
              Annuler
            </Button>
            <Button type="button" disabled={ragSaving} onClick={() => void saveRag()}>
              {ragSaving ? <Loader2 className="size-4 animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </div>
      </AppModal>
    </DashboardShell>
  );
}
