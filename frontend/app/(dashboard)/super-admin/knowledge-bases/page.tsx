"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { KnowledgeBase, Organization } from "@/lib/types";
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

  useEffect(() => {
    setLoading(true);
    Promise.all([loadWorkspace(), loadOrgs(), loadKbs()])
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [loadWorkspace, loadOrgs, loadKbs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((kb) => {
      if (!q) return true;
      return (
        kb.name.toLowerCase().includes(q) ||
        (kb.description || "").toLowerCase().includes(q) ||
        (kb.organization_name || "").toLowerCase().includes(q)
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
      toast.success("Knowledge base créée");
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

  const remove = async (id: string) => {
    if (
      !confirm(
        "Supprimer cette knowledge base ? Les documents liés, leurs points Qdrant et les assistants associés seront aussi supprimés."
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
        description="Créez une KB par thème, puis rattachez-y documents et assistants."
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
        searchPlaceholder="Nom, description, organisation…"
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
              description="Créez une KB (ex. RH, Finance) pour isoler les documents par thème."
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
                <TableHead>Description</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Créée</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((kb) => (
                <TableRow key={kb.id}>
                  <TableCell className="font-medium">{kb.name}</TableCell>
                  {scope === "all" ? (
                    <TableCell className="text-muted-foreground">
                      {kb.organization_name || "—"}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-muted-foreground">
                    {kb.description || "—"}
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

      <AppModal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        labelledBy="create-sa-kb-title"
      >
        <h2 id="create-sa-kb-title" className="text-lg font-semibold">
          Nouvelle knowledge base
        </h2>
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
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
            </Button>
          </div>
        </form>
      </AppModal>
    </DashboardShell>
  );
}
