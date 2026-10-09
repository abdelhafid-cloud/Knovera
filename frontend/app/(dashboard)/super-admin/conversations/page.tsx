"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Eye, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Conversation } from "@/lib/types";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
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

type PlatformConversation = Conversation & { organization_name?: string | null };

export default function PlatformConversationsPage() {
  const [items, setItems] = useState<PlatformConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewItem, setViewItem] = useState<PlatformConversation | null>(null);
  const [editItem, setEditItem] = useState<PlatformConversation | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = async () => {
    const r = await api.get<PlatformConversation[]>("/api/admin/conversations");
    setItems(r.data || []);
  };

  useEffect(() => {
    setLoading(true);
    load()
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

  const openView = async (c: PlatformConversation) => {
    setBusyId(c.id);
    try {
      const r = await api.get<PlatformConversation>(`/api/admin/conversations/${c.id}`);
      setViewItem(r.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (c: PlatformConversation) => {
    setEditItem(c);
    setEditTitle(c.title || "");
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    setSavingEdit(true);
    try {
      await api.patch(`/api/admin/conversations/${editItem.id}`, {
        title: editTitle.trim() || "Sans titre",
      });
      toast.success("Conversation mise à jour");
      setEditItem(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (c: PlatformConversation) => {
    if (!confirm(`Supprimer la conversation « ${c.title || "Sans titre"} » ?`)) return;
    setBusyId(c.id);
    try {
      await api.delete(`/api/admin/conversations/${c.id}`);
      toast.success("Conversation supprimée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Conversations" breadcrumbs={["Super Admin", "Conversations"]}>
      <PageHeader description="Activité de chat récente sur l’ensemble des organisations." />
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
                <TableHead className="w-[70px] text-right">Actions</TableHead>
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
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={busyId === c.id}
                        >
                          {busyId === c.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openView(c)}>
                          <Eye className="size-4" />
                          Afficher
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(c)}>
                          <Pencil className="size-4" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => remove(c)}
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

      <AppModal
        open={!!viewItem}
        onClose={() => setViewItem(null)}
        labelledBy="view-conversation-title"
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {viewItem ? (
          <div className="space-y-4">
            <h2 id="view-conversation-title" className="text-lg font-semibold">
              Afficher la conversation
            </h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Titre</dt>
                <dd className="font-medium">{viewItem.title || "Sans titre"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Organisation</dt>
                <dd>{viewItem.organization_name || "—"}</dd>
              </div>
            </dl>
            <div className="space-y-2">
              <p className="text-sm font-medium">Messages</p>
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {(viewItem.messages || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun message</p>
                ) : (
                  (viewItem.messages || []).map((m) => (
                    <div
                      key={m.id}
                      className="rounded-md bg-muted/40 px-3 py-2 text-sm"
                    >
                      <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                        {m.role}
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setViewItem(null)}>
                Fermer
              </Button>
              <Button
                type="button"
                onClick={() => {
                  openEdit(viewItem);
                  setViewItem(null);
                }}
              >
                Modifier
              </Button>
            </div>
          </div>
        ) : null}
      </AppModal>

      <AppModal
        open={!!editItem}
        onClose={() => !savingEdit && setEditItem(null)}
        labelledBy="edit-conversation-title"
      >
        <h2 id="edit-conversation-title" className="text-lg font-semibold">
          Modifier la conversation
        </h2>
        <form onSubmit={saveEdit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Titre</Label>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditItem(null)}
              disabled={savingEdit}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={savingEdit}>
              {savingEdit ? <Loader2 className="size-4 animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </form>
      </AppModal>
    </DashboardShell>
  );
}
