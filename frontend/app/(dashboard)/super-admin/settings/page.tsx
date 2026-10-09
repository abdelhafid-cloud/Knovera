"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { DashboardShell, PageHeader } from "@/components/layout/app-shell";
import { OrgLogo } from "@/components/organizations/org-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PlatformSettings = {
  branding: {
    platform_name: string;
    tagline: string;
    support_email: string;
  };
  default_quotas: {
    max_members: number;
    max_documents: number;
    max_assistants: number;
    max_knowledge_bases: number;
    max_storage_gb: number;
  };
  default_rag: {
    chunk_size: number;
    overlap: number;
    top_k: number;
  };
  default_llm: {
    provider: string;
    model: string;
    temperature: number;
  };
  features: {
    allow_org_invitations: boolean;
    allow_member_chat: boolean;
  };
};

const emptySettings = (): PlatformSettings => ({
  branding: { platform_name: "Knovera", tagline: "", support_email: "" },
  default_quotas: {
    max_members: 50,
    max_documents: 500,
    max_assistants: 20,
    max_knowledge_bases: 20,
    max_storage_gb: 5,
  },
  default_rag: { chunk_size: 800, overlap: 120, top_k: 5 },
  default_llm: { provider: "openai", model: "gpt-4o-mini", temperature: 0.2 },
  features: { allow_org_invitations: true, allow_member_chat: true },
});

export default function PlatformSettingsPage() {
  const { refreshMe } = useAuth();
  const [settings, setSettings] = useState<PlatformSettings>(emptySettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Mon espace");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<PlatformSettings>("/api/admin/settings"),
      api.get<{ organization?: { id: string; name: string; logo_url?: string | null } }>(
        "/api/admin/workspace"
      ),
    ])
      .then(([settingsRes, workspaceRes]) => {
        setSettings({ ...emptySettings(), ...(settingsRes.data || {}) });
        const org = workspaceRes.data?.organization;
        setWorkspaceId(org?.id || null);
        setWorkspaceName(org?.name || "Mon espace");
        setLogoUrl(org?.logo_url || null);
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const onLogoSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !workspaceId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choisissez une image");
      return;
    }
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await api.upload<{ logo_url?: string | null }>(
        `/api/organizations/${workspaceId}/logo`,
        fd
      );
      setLogoUrl(res.data?.logo_url || null);
      await refreshMe();
      toast.success("Logo de votre espace mis à jour");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    if (!workspaceId) return;
    setUploadingLogo(true);
    try {
      const res = await api.delete<{ logo_url?: string | null }>(
        `/api/organizations/${workspaceId}/logo`
      );
      setLogoUrl(res.data?.logo_url || null);
      await refreshMe();
      toast.success("Logo supprimé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setUploadingLogo(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.patch<PlatformSettings>("/api/admin/settings", settings);
      setSettings({ ...emptySettings(), ...(r.data || {}) });
      toast.success("Paramètres Knovera enregistrés");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardShell title="Paramètres" breadcrumbs={["Super Admin", "Paramètres"]}>
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Paramètres" breadcrumbs={["Super Admin", "Paramètres"]}>
      <PageHeader description="Paramètres globaux Knovera — appliqués par défaut aux nouvelles organisations, KB et assistants." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Logo de mon espace</CardTitle>
          <CardDescription>
            Uniquement votre espace ({workspaceName}). Les logos des autres organisations ne sont pas modifiables ici.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <OrgLogo name={workspaceName} logoUrl={logoUrl} className="size-16 rounded-xl" iconClassName="size-7" />
            {uploadingLogo ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={logoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={onLogoSelected}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingLogo || !workspaceId}
              onClick={() => logoRef.current?.click()}
            >
              <Camera className="size-4" />
              Changer le logo
            </Button>
            {logoUrl ? (
              <Button type="button" variant="ghost" size="sm" disabled={uploadingLogo} onClick={removeLogo}>
                <Trash2 className="size-4" />
                Supprimer
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Identité plateforme</CardTitle>
            <CardDescription>Nom et contacts affichés pour Knovera.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nom de la plateforme</Label>
              <Input
                value={settings.branding.platform_name}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    branding: { ...s.branding, platform_name: e.target.value },
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Baseline / tagline</Label>
              <Input
                value={settings.branding.tagline}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    branding: { ...s.branding, tagline: e.target.value },
                  }))
                }
                placeholder="Plateforme RAG multi-organisations"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Email support</Label>
              <Input
                type="email"
                value={settings.branding.support_email}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    branding: { ...s.branding, support_email: e.target.value },
                  }))
                }
                placeholder="support@knovera.app"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quotas par défaut</CardTitle>
            <CardDescription>Appliqués à chaque nouvelle organisation.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["max_members", "Membres"],
                ["max_documents", "Documents"],
                ["max_assistants", "Assistants"],
                ["max_knowledge_bases", "Knowledge bases"],
                ["max_storage_gb", "Stockage (Go)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.default_quotas[key]}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      default_quotas: {
                        ...s.default_quotas,
                        [key]: Number(e.target.value) || 0,
                      },
                    }))
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>RAG par défaut</CardTitle>
            <CardDescription>Chunking et retrieval pour les nouvelles knowledge bases.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["chunk_size", "Taille de chunk"],
                ["overlap", "Overlap"],
                ["top_k", "Top K"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.default_rag[key]}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      default_rag: {
                        ...s.default_rag,
                        [key]: Number(e.target.value) || 0,
                      },
                    }))
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LLM par défaut</CardTitle>
            <CardDescription>Provider et modèle proposés pour les nouveaux assistants.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Provider</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.default_llm.provider}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    default_llm: { ...s.default_llm, provider: e.target.value },
                  }))
                }
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Modèle</Label>
              <Input
                value={settings.default_llm.model}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    default_llm: { ...s.default_llm, model: e.target.value },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Température</Label>
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={settings.default_llm.temperature}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    default_llm: {
                      ...s.default_llm,
                      temperature: Number(e.target.value) || 0,
                    },
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fonctionnalités</CardTitle>
            <CardDescription>Options globales de la plateforme.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.features.allow_org_invitations}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    features: { ...s.features, allow_org_invitations: e.target.checked },
                  }))
                }
              />
              Autoriser les invitations d’organisation
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.features.allow_member_chat}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    features: { ...s.features, allow_member_chat: e.target.checked },
                  }))
                }
              />
              Autoriser le chat pour les membres
            </label>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Enregistrer"}
          </Button>
        </div>
      </form>
    </DashboardShell>
  );
}
