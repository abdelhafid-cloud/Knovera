"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Plus, Settings, Shield, Trash2, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { openAssistantChat } from "@/lib/chat-url";
import type { Assistant, KnowledgeBase, Membership, User } from "@/lib/types";
import { useAuth } from "@/components/providers/auth-provider";
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

const emptyForm = {
  name: "",
  description: "",
  knowledge_base_id: "",
  welcome_message: "Bonjour, comment puis-je vous aider ?",
  llm_provider: "openai",
  model: "gpt-4o-mini",
  system_prompt: "",
  temperature: 0.2,
};

export default function AssistantsAdminPage() {
  const { organization, isSuperAdmin } = useAuth();
  const [items, setItems] = useState<Assistant[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  type MemberRow = Membership & { user?: User | null };
  type AccessPayload = {
    user_ids: string[];
    role_ids: string[];
    users: { id: string; email: string; full_name?: string }[];
    roles: { id: string; code: string; name: string }[];
    available_roles?: { id: string; code: string; name: string }[];
  };

  const [accessOpen, setAccessOpen] = useState(false);
  const [accessAssistant, setAccessAssistant] = useState<Assistant | null>(null);
  const [accessMembers, setAccessMembers] = useState<MemberRow[]>([]);
  const [accessAvailableRoles, setAccessAvailableRoles] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [accessUserIds, setAccessUserIds] = useState<string[]>([]);
  const [accessRoleIds, setAccessRoleIds] = useState<string[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);

  const [ragOpen, setRagOpen] = useState(false);
  const [ragAssistant, setRagAssistant] = useState<Assistant | null>(null);
  const [ragForm, setRagForm] = useState({
    top_k: 5,
    min_score: 0.5,
    hybrid_search: false,
    rerank: false,
  });
  const [ragSaving, setRagSaving] = useState(false);

  const roleIdByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of accessAvailableRoles) {
      if (r.code && r.id) map[r.code] = r.id;
    }
    for (const m of accessMembers) {
      const code = m.role?.code;
      if (code && m.role?.id) map[code] = m.role.id;
    }
    return map;
  }, [accessAvailableRoles, accessMembers]);

  const load = async () => {
    const [a, k] = await Promise.all([
      api.get<Assistant[]>("/api/assistants"),
      api.get<KnowledgeBase[]>("/api/knowledge-bases"),
    ]);
    setItems(a.data || []);
    setKbs(k.data || []);
  };

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((a) => {
      if (filter === "active" && !a.is_active) return false;
      if (filter === "inactive" && a.is_active) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q) ||
        (a.model || "").toLowerCase().includes(q) ||
        (a.llm_provider || "").toLowerCase().includes(q)
      );
    });
  }, [items, query, filter]);

  const selectedKb = kbs.find((k) => k.id === form.knowledge_base_id);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/api/assistants", form);
      toast.success("Assistant créé");
      setForm(emptyForm);
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const openAccess = async (a: Assistant) => {
    if (!organization?.id) return;
    setAccessAssistant(a);
    setAccessOpen(true);
    setAccessLoading(true);
    try {
      const [membersRes, accessRes] = await Promise.all([
        api.get<MemberRow[]>(`/api/organizations/${organization.id}/members`),
        api.get<AccessPayload>(`/api/assistants/${a.id}/access`),
      ]);
      setAccessMembers(membersRes.data || []);
      setAccessAvailableRoles(accessRes.data?.available_roles || accessRes.data?.roles || []);
      setAccessUserIds(accessRes.data?.user_ids || []);
      setAccessRoleIds(accessRes.data?.role_ids || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setAccessOpen(false);
    } finally {
      setAccessLoading(false);
    }
  };

  const saveAccess = async () => {
    if (!accessAssistant) return;
    setAccessSaving(true);
    try {
      await api.put(`/api/assistants/${accessAssistant.id}/access`, {
        user_ids: accessUserIds,
        role_ids: accessRoleIds,
      });
      toast.success("Accès enregistrés");
      setAccessOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setAccessSaving(false);
    }
  };

  const toggleAccessUser = (userId: string) => {
    setAccessUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleAccessRoleCode = (code: "org_member" | "org_admin") => {
    const rid = roleIdByCode[code];
    if (!rid) {
      toast.error(`Rôle ${code} introuvable`);
      return;
    }
    setAccessRoleIds((prev) =>
      prev.includes(rid) ? prev.filter((id) => id !== rid) : [...prev, rid]
    );
  };

  const openRag = (a: Assistant) => {
    const rs = (a.rag_settings || {}) as Record<string, unknown>;
    setRagAssistant(a);
    setRagForm({
      top_k: Number(rs.top_k ?? a.top_k ?? 5),
      min_score: Number(rs.min_score ?? 0.25),
      hybrid_search: rs.hybrid_search !== false,
      rerank: rs.rerank !== false,
    });
    setRagOpen(true);
  };

  const saveRag = async () => {
    if (!ragAssistant) return;
    setRagSaving(true);
    try {
      await api.patch(`/api/assistants/${ragAssistant.id}`, {
        rag_settings: {
          top_k: Number(ragForm.top_k),
          min_score: Number(ragForm.min_score),
          hybrid_search: ragForm.hybrid_search,
          rerank: ragForm.rerank,
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
    if (!confirm("Supprimer cet assistant ?")) return;
    setBusyId(id);
    try {
      await api.delete(`/api/assistants/${id}`);
      toast.success("Assistant supprimé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell title="Assistants" breadcrumbs={["Organisation", "Assistants"]}>
      <PageHeader
        description={
          isSuperAdmin
            ? "Créez les assistants (provider LLM, modèle, prompt) pour l’organisation."
            : "Consultation des assistants provisionnés par la plateforme ; gérez les accès membres via « Accès »."
        }
        actions={
          isSuperAdmin ? (
            <Button
              onClick={() => {
                setForm(emptyForm);
                setCreateOpen(true);
              }}
            >
              <Plus className="size-4" />
              Ajouter
            </Button>
          ) : undefined
        }
      />
      <TableToolbar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Nom, provider, modèle…"
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
            <EmptyState title="Aucun assistant" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
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
                    <div className="line-clamp-1 text-xs text-muted-foreground">
                      {a.description || "—"}
                    </div>
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
                    {a.created_at ? new Date(a.created_at).toLocaleDateString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" disabled={busyId === a.id}>
                          {busyId === a.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            openAssistantChat(a.id, a.organization_id || organization?.id)
                          }
                        >
                          <ExternalLink className="size-4" />
                          Accéder
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openAccess(a)}>
                          <Shield className="size-4" />
                          Accès
                        </DropdownMenuItem>
                        {isSuperAdmin ? (
                          <>
                            <DropdownMenuItem onClick={() => openRag(a)}>
                              <Settings className="size-4" />
                              Réglages RAG
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => remove(a.id)}
                            >
                              <Trash2 className="size-4" />
                              Supprimer
                            </DropdownMenuItem>
                          </>
                        ) : null}
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
        labelledBy="create-assistant-title"
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <h2 id="create-assistant-title" className="text-lg font-semibold">
          Nouvel assistant
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configurez le provider, le modèle et le system prompt (générable automatiquement).
        </p>
        <form onSubmit={create} className="mt-4 space-y-4">
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
            disabled={creating}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Créer"}
            </Button>
          </div>
        </form>
      </AppModal>

      <AppModal
        open={accessOpen}
        onClose={() => !accessSaving && setAccessOpen(false)}
        labelledBy="access-assistant-title"
        className="max-w-lg max-h-[85vh] overflow-y-auto"
      >
        <h2 id="access-assistant-title" className="text-lg font-semibold">
          Accès — {accessAssistant?.name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Membres et rôles autorisés à utiliser cet assistant.
        </p>
        {accessLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">Rôles</p>
              <div className="space-y-2">
                {(["org_member", "org_admin"] as const).map((code) => {
                  const rid = roleIdByCode[code];
                  return (
                    <label
                      key={code}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        disabled={!rid}
                        checked={rid ? accessRoleIds.includes(rid) : false}
                        onChange={() => toggleAccessRoleCode(code)}
                      />
                      {code === "org_admin" ? "Admin organisation" : "Membre organisation"}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Membres</p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {accessMembers.filter((m) => m.status === "active").length === 0 ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">Aucun membre actif.</p>
                ) : (
                  accessMembers
                    .filter((m) => m.status === "active" && m.user?.id)
                    .map((m) => (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                      >
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input"
                          checked={accessUserIds.includes(m.user!.id)}
                          onChange={() => toggleAccessUser(m.user!.id)}
                        />
                        <span className="min-w-0 truncate">
                          {m.user?.full_name || m.user?.email}
                        </span>
                      </label>
                    ))
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAccessOpen(false)}>
                Annuler
              </Button>
              <Button type="button" disabled={accessSaving} onClick={() => void saveAccess()}>
                {accessSaving ? <Loader2 className="size-4 animate-spin" /> : "Enregistrer"}
              </Button>
            </div>
          </div>
        )}
      </AppModal>

      <AppModal
        open={ragOpen}
        onClose={() => !ragSaving && setRagOpen(false)}
        labelledBy="rag-assistant-title"
        className="max-w-md"
      >
        <h2 id="rag-assistant-title" className="text-lg font-semibold">
          Réglages RAG — {ragAssistant?.name}
        </h2>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Top K</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={ragForm.top_k}
              onChange={(e) => setRagForm({ ...ragForm, top_k: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Score minimum (0–1)</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={ragForm.min_score}
              onChange={(e) => setRagForm({ ...ragForm, min_score: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={ragForm.hybrid_search}
              onChange={(e) => setRagForm({ ...ragForm, hybrid_search: e.target.checked })}
            />
            Recherche hybride
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={ragForm.rerank}
              onChange={(e) => setRagForm({ ...ragForm, rerank: e.target.checked })}
            />
            Rerank (Cohere)
          </label>
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
