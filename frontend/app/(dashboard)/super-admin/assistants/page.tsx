"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Plus, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { openAssistantChat } from "@/lib/chat-url";
import type { Assistant, KnowledgeBase, Organization } from "@/lib/types";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
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

type PlatformAssistant = Assistant & { organization_name?: string | null };

type WorkspacePayload = {
  organization: Organization;
  default_knowledge_base_id: string;
  knowledge_bases: KnowledgeBase[];
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

export default function PlatformAssistantsPage() {
  const [items, setItems] = useState<PlatformAssistant[]>([]);
  const [workspace, setWorkspace] = useState<Organization | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    organization_id: "",
    name: "",
    description: "",
    knowledge_base_id: "",
    welcome_message: "Bonjour, comment puis-je vous aider ?",
  });

  const loadAssistants = useCallback(async () => {
    const r = await api.get<PlatformAssistant[]>("/api/admin/assistants");
    setItems(r.data || []);
  }, []);

  const loadWorkspace = useCallback(async () => {
    const r = await api.get<WorkspacePayload>("/api/admin/workspace");
    setWorkspace(r.data.organization);
    return r.data;
  }, []);

  const loadOrgs = useCallback(async () => {
    const r = await api.get<Organization[]>("/api/organizations?include_workspace=1");
    setOrgs((r.data || []).filter((o) => o.status === "active"));
  }, []);

  const loadKbs = useCallback(
    async (orgId: string, preferredKbId?: string) => {
      if (!orgId) {
        setKbs([]);
        return;
      }
      if (workspace && orgId === workspace.id) {
        const r = await api.get<WorkspacePayload>("/api/admin/workspace");
        const list = r.data.knowledge_bases || [];
        setKbs(list);
        setForm((f) => ({
          ...f,
          knowledge_base_id:
            preferredKbId ||
            (list.some((k) => k.id === f.knowledge_base_id) ? f.knowledge_base_id : "") ||
            r.data.default_knowledge_base_id ||
            list[0]?.id ||
            "",
        }));
        return;
      }
      const r = await withOrgContext(orgId, () => api.get<KnowledgeBase[]>("/api/knowledge-bases"));
      const list = r.data || [];
      setKbs(list);
      setForm((f) => ({
        ...f,
        knowledge_base_id:
          preferredKbId ||
          (list.some((k) => k.id === f.knowledge_base_id) ? f.knowledge_base_id : "") ||
          list[0]?.id ||
          "",
      }));
    },
    [workspace]
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAssistants(), loadWorkspace(), loadOrgs()])
      .then(([_, ws]) => {
        if (ws?.organization?.id) {
          setForm((f) => ({
            ...f,
            organization_id: f.organization_id || ws.organization.id,
            knowledge_base_id: f.knowledge_base_id || ws.default_knowledge_base_id || "",
          }));
        }
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [loadAssistants, loadWorkspace, loadOrgs]);

  useEffect(() => {
    if (!form.organization_id || !workspace) return;
    loadKbs(form.organization_id).catch((e: Error) => toast.error(e.message));
  }, [form.organization_id, workspace, loadKbs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((a) => {
      if (filter === "active" && !a.is_active) return false;
      if (filter === "inactive" && a.is_active) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.organization_name || "").toLowerCase().includes(q) ||
        (a.model || "").toLowerCase().includes(q)
      );
    });
  }, [items, query, filter]);

  const uploadTargets = useMemo(() => {
    if (!workspace) return orgs;
    const others = orgs.filter((o) => o.id !== workspace.id);
    return [workspace, ...others];
  }, [orgs, workspace]);

  const openCreate = () => {
    setForm((f) => ({
      ...f,
      organization_id: f.organization_id || workspace?.id || "",
      name: "",
      description: "",
      welcome_message: "Bonjour, comment puis-je vous aider ?",
    }));
    setCreateOpen(true);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.organization_id || !form.knowledge_base_id || !form.name.trim()) {
      toast.error("Organisation, knowledge base et nom requis");
      return;
    }
    setCreating(true);
    try {
      await api.post("/api/admin/assistants", {
        organization_id: form.organization_id,
        knowledge_base_id: form.knowledge_base_id,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        welcome_message: form.welcome_message,
      });
      toast.success("Assistant créé");
      setCreateOpen(false);
      await loadAssistants();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  return (
    <DashboardShell title="Assistants" breadcrumbs={["Super Admin", "Assistants"]}>
      <PageHeader
        description="Créez un assistant dans votre espace ou dans une organisation."
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
        searchPlaceholder="Nom, org, modèle…"
        filters={[
          { value: "all", label: "Tous" },
          { value: "active", label: "Actifs" },
          { value: "inactive", label: "Inactifs" },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
        countLabel={`${filtered.length} / ${items.length}`}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Aucun assistant"
              description="Cliquez sur Ajouter pour créer le premier assistant."
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
                <TableHead>Organisation</TableHead>
                <TableHead>Modèle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Créé</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    {a.description ? (
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {a.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.organization_name || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.model || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={a.is_active ? "success" : "secondary"}>
                      {a.is_active ? "actif" : "inactif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {a.created_at ? new Date(a.created_at).toLocaleString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => openAssistantChat(a.id, a.organization_id)}
                        >
                          <ExternalLink className="size-4" />
                          Accéder
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
        labelledBy="create-sa-assistant-title"
        className="max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <h2 id="create-sa-assistant-title" className="text-lg font-semibold">
          Nouvel assistant
        </h2>
        <form onSubmit={create} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Espace / organisation</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.organization_id}
              onChange={(e) => setForm({ ...form, organization_id: e.target.value, knowledge_base_id: "" })}
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
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Knowledge base</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.knowledge_base_id}
              onChange={(e) => setForm({ ...form, knowledge_base_id: e.target.value })}
              required
            >
              <option value="">Sélectionner…</option>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
            {kbs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucune KB dans cet espace — créez-en une ou uploadez d’abord un document.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Annuler
            </Button>
            <Button type="submit" disabled={creating || !form.knowledge_base_id}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
            </Button>
          </div>
        </form>
      </AppModal>
    </DashboardShell>
  );
}
