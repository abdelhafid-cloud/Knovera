"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Eye, ExternalLink, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { openAssistantChat } from "@/lib/chat-url";
import type { Assistant, KnowledgeBase, Organization } from "@/lib/types";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { ProviderBadge } from "@/components/ui/storage-badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BannerColorField } from "@/components/assistants/banner-color-field";
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
import { AssistantLlmFields } from "@/components/assistants/assistant-llm-fields";

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

const emptyLlm = {
  welcome_message: "Bonjour, comment puis-je vous aider ?",
  llm_provider: "openai",
  model: "gpt-4o-mini",
  system_prompt: "",
  temperature: 0.2,
  banner_color: "#3B82F6",
};

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewItem, setViewItem] = useState<PlatformAssistant | null>(null);
  const [editItem, setEditItem] = useState<PlatformAssistant | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    knowledge_base_id: "",
    is_active: true,
    ...emptyLlm,
  });
  const [editKbs, setEditKbs] = useState<KnowledgeBase[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [form, setForm] = useState({
    organization_id: "",
    name: "",
    description: "",
    knowledge_base_id: "",
    ...emptyLlm,
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
        (a.model || "").toLowerCase().includes(q) ||
        (a.llm_provider || "").toLowerCase().includes(q)
      );
    });
  }, [items, query, filter]);

  const uploadTargets = useMemo(() => {
    if (!workspace) return orgs;
    const others = orgs.filter((o) => o.id !== workspace.id);
    return [workspace, ...others];
  }, [orgs, workspace]);

  const selectedKb = kbs.find((k) => k.id === form.knowledge_base_id);

  const openCreate = () => {
    setForm((f) => ({
      ...f,
      organization_id: f.organization_id || workspace?.id || "",
      name: "",
      description: "",
      ...emptyLlm,
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
        llm_provider: form.llm_provider,
        model: form.model,
        system_prompt: form.system_prompt || undefined,
        temperature: form.temperature,
        banner_color: form.banner_color,
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

  const openView = async (a: PlatformAssistant) => {
    setBusyId(a.id);
    try {
      const r = await api.get<PlatformAssistant>(`/api/admin/assistants/${a.id}`);
      setViewItem(r.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = async (a: PlatformAssistant) => {
    setBusyId(a.id);
    try {
      const r = await api.get<PlatformAssistant>(`/api/admin/assistants/${a.id}`);
      const data = r.data;
      setEditItem(data);
      setEditForm({
        name: data.name || "",
        description: data.description || "",
        knowledge_base_id: data.knowledge_base_id || "",
        is_active: !!data.is_active,
        welcome_message: data.welcome_message || emptyLlm.welcome_message,
        llm_provider: data.llm_provider || emptyLlm.llm_provider,
        model: data.model || emptyLlm.model,
        system_prompt: data.system_prompt || "",
        temperature: data.temperature ?? emptyLlm.temperature,
        banner_color: data.banner_color || emptyLlm.banner_color,
      });
      const kbRes = await withOrgContext(data.organization_id, () =>
        api.get<KnowledgeBase[]>("/api/knowledge-bases")
      );
      setEditKbs(kbRes.data || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editItem || !editForm.name.trim() || !editForm.knowledge_base_id) return;
    setSavingEdit(true);
    try {
      await api.patch(`/api/admin/assistants/${editItem.id}`, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        knowledge_base_id: editForm.knowledge_base_id,
        welcome_message: editForm.welcome_message,
        llm_provider: editForm.llm_provider,
        model: editForm.model,
        system_prompt: editForm.system_prompt,
        temperature: editForm.temperature,
        banner_color: editForm.banner_color,
        is_active: editForm.is_active,
      });
      toast.success("Assistant mis à jour");
      setEditItem(null);
      await loadAssistants();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (a: PlatformAssistant) => {
    if (!confirm(`Supprimer l’assistant « ${a.name} » ?`)) return;
    setBusyId(a.id);
    try {
      await api.delete(`/api/admin/assistants/${a.id}`);
      toast.success("Assistant supprimé");
      await loadAssistants();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Assistants" breadcrumbs={["Super Admin", "Assistants"]}>
      <PageHeader
        description="Provider LLM, modèle et prompt généré par agent — stocké en base."
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
        searchPlaceholder="Nom, org, provider, modèle…"
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
                <TableHead>Provider</TableHead>
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
                  <TableCell>
                    <ProviderBadge provider={a.llm_provider} />
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-muted-foreground">
                    {a.model || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.is_active ? "success" : "muted"}>
                      {a.is_active ? "actif" : "inactif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {a.created_at ? new Date(a.created_at).toLocaleString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={busyId === a.id}
                        >
                          {busyId === a.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openView(a)}>
                          <Eye className="size-4" />
                          Afficher
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(a)}>
                          <Pencil className="size-4" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openAssistantChat(a.id, a.organization_id)}
                        >
                          <ExternalLink className="size-4" />
                          Accéder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => remove(a)}
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
        labelledBy="view-assistant-title"
        className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {viewItem ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <h2 id="view-assistant-title" className="shrink-0 text-lg font-semibold">
              Afficher l’assistant
            </h2>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Nom</dt>
                  <dd className="font-medium">{viewItem.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Organisation</dt>
                  <dd>{viewItem.organization_name || "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Description</dt>
                  <dd>{viewItem.description || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd>
                    <ProviderBadge provider={viewItem.llm_provider} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Modèle</dt>
                  <dd>{viewItem.model || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Température</dt>
                  <dd>{viewItem.temperature ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Top K</dt>
                  <dd>{viewItem.top_k ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Statut</dt>
                  <dd>{viewItem.is_active ? "actif" : "inactif"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Message d’accueil</dt>
                  <dd>{viewItem.welcome_message || "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="mb-1.5 text-muted-foreground">System prompt</dt>
                  <dd className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed">
                    {viewItem.system_prompt || "—"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" onClick={() => setViewItem(null)}>
                Fermer
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const current = viewItem;
                  setViewItem(null);
                  void openEdit(current);
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
        labelledBy="edit-assistant-title"
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <h2 id="edit-assistant-title" className="text-lg font-semibold">
          Modifier l’assistant
        </h2>
        <form onSubmit={saveEdit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Knowledge base</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={editForm.knowledge_base_id}
              onChange={(e) => setEditForm({ ...editForm, knowledge_base_id: e.target.value })}
              required
            >
              {editKbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Couleur du bandeau</Label>
            <BannerColorField
              value={editForm.banner_color}
              onChange={(banner_color) => setEditForm({ ...editForm, banner_color })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
            />
            Actif
          </label>
          <AssistantLlmFields
            value={{
              llm_provider: editForm.llm_provider,
              model: editForm.model,
              system_prompt: editForm.system_prompt,
              temperature: editForm.temperature,
              welcome_message: editForm.welcome_message,
            }}
            onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
            name={editForm.name}
            description={editForm.description}
            knowledgeBaseId={editForm.knowledge_base_id}
            knowledgeBaseLabel={editKbs.find((k) => k.id === editForm.knowledge_base_id)?.name}
            organizationId={editItem?.organization_id}
            disabled={savingEdit}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditItem(null)} disabled={savingEdit}>
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
        labelledBy="create-sa-assistant-title"
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <h2 id="create-sa-assistant-title" className="text-lg font-semibold">
          Nouvel assistant
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Provider, modèle et prompt dédié — généré à partir du nom / description / KB.
        </p>
        <form onSubmit={create} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Espace / organisation</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.organization_id}
              onChange={(e) =>
                setForm({ ...form, organization_id: e.target.value, knowledge_base_id: "" })
              }
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
              placeholder="Rôle / périmètre de l’agent"
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
                Aucune KB dans cet espace — créez-en une d’abord.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Couleur du bandeau</Label>
            <BannerColorField
              value={form.banner_color}
              onChange={(banner_color) => setForm((f) => ({ ...f, banner_color }))}
            />
          </div>

          <AssistantLlmFields
            value={{
              llm_provider: form.llm_provider,
              model: form.model,
              system_prompt: form.system_prompt,
              temperature: form.temperature,
              welcome_message: form.welcome_message,
            }}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            name={form.name}
            description={form.description}
            knowledgeBaseId={form.knowledge_base_id}
            knowledgeBaseLabel={selectedKb?.name}
            organizationId={form.organization_id}
            disabled={creating}
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
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
