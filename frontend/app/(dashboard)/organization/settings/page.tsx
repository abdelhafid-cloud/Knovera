"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { api } from "@/lib/api";
import type { Organization, OrgQuotas, QuotaItem } from "@/lib/types";
import { DashboardShell } from "@/components/layout/app-shell";
import { OrgLogo } from "@/components/organizations/org-logo";
import { QuotaBar } from "@/components/ui/quota-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type QuotaForm = {
  max_members: number;
  max_documents: number;
  max_assistants: number;
  max_knowledge_bases: number;
  max_storage_gb: number;
};

export default function OrgSettingsPage() {
  const { organization, refreshMe } = useAuth();
  const [name, setName] = useState(organization?.name || "");
  const [logoUrl, setLogoUrl] = useState<string | null>(organization?.logo_url || null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [usageItems, setUsageItems] = useState<QuotaItem[]>([]);
  const [usageLoading, setUsageLoading] = useState(true);
  const [quotaForm, setQuotaForm] = useState<QuotaForm>({
    max_members: 50,
    max_documents: 500,
    max_assistants: 20,
    max_knowledge_bases: 20,
    max_storage_gb: 5,
  });
  const [savingQuotas, setSavingQuotas] = useState(false);

  useEffect(() => {
    setName(organization?.name || "");
    setLogoUrl(organization?.logo_url || null);
  }, [organization?.name, organization?.logo_url]);

  useEffect(() => {
    if (!organization?.id) return;
    setUsageLoading(true);
    api
      .get<{ items?: QuotaItem[]; quotas?: OrgQuotas }>(
        `/api/organizations/${organization.id}/usage`
      )
      .then((r) => {
        setUsageItems(r.data?.items || []);
        const q = r.data?.quotas || organization.quotas;
        if (q) {
          setQuotaForm({
            max_members: q.max_members,
            max_documents: q.max_documents,
            max_assistants: q.max_assistants,
            max_knowledge_bases: q.max_knowledge_bases,
            max_storage_gb: Math.round(q.max_storage_bytes / (1024 * 1024 * 1024)),
          });
        }
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setUsageLoading(false));
  }, [organization?.id, organization?.quotas]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization?.id) return;
    try {
      await api.patch(`/api/organizations/${organization.id}`, { name });
      await refreshMe();
      toast.success("Paramètres enregistrés");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const saveQuotas = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization?.id) return;
    setSavingQuotas(true);
    try {
      const r = await api.patch<Organization>(`/api/organizations/${organization.id}`, {
        quotas: {
          max_members: Number(quotaForm.max_members),
          max_documents: Number(quotaForm.max_documents),
          max_assistants: Number(quotaForm.max_assistants),
          max_knowledge_bases: Number(quotaForm.max_knowledge_bases),
          max_storage_bytes: Number(quotaForm.max_storage_gb) * 1024 * 1024 * 1024,
        },
      });
      setUsageItems(r.data?.items || usageItems);
      await refreshMe();
      toast.success("Quotas enregistrés");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingQuotas(false);
    }
  };

  const onLogoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !organization?.id) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await api.upload<Organization>(`/api/organizations/${organization.id}/logo`, fd);
      setLogoUrl(res.data?.logo_url || null);
      await refreshMe();
      toast.success("Logo mis à jour");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur logo");
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    if (!organization?.id) return;
    setUploading(true);
    try {
      const res = await api.delete<Organization>(`/api/organizations/${organization.id}/logo`);
      setLogoUrl(res.data?.logo_url || null);
      await refreshMe();
      toast.success("Logo supprimé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setUploading(false);
    }
  };

  return (
    <DashboardShell title="Paramètres" breadcrumbs={["Organisation", "Paramètres"]}>
      <div className="max-w-lg space-y-6">
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Logo de l&apos;organisation</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Affiché dans la liste des organisations et le sélecteur. JPG, PNG, WEBP ou GIF — max 2 Mo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative">
              <OrgLogo
                name={organization?.name}
                logoUrl={logoUrl}
                className="size-16 rounded-xl"
                iconClassName="size-7"
              />
              {uploading ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70">
                  <Loader2 className="size-5 animate-spin text-primary" />
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={onLogoSelected}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading || !organization?.id}
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="size-4" />
                Changer le logo
              </Button>
              {logoUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={removeLogo}
                >
                  <Trash2 className="size-4" />
                  Supprimer
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <form onSubmit={save} className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="space-y-2">
            <Label>Nom de l&apos;organisation</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <Button type="submit">Enregistrer</Button>
        </form>

        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Usage et quotas</h2>
          {usageLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : usageItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée d&apos;usage.</p>
          ) : (
            <div className="space-y-4">
              {usageItems.map((item) => (
                <QuotaBar key={item.key} item={item} />
              ))}
            </div>
          )}

          <form onSubmit={saveQuotas} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Réservé aux administrateurs organisation — ajustez les plafonds.
            </p>
            {(
              [
                ["max_members", "Max membres"],
                ["max_documents", "Max documents"],
                ["max_assistants", "Max assistants"],
                ["max_knowledge_bases", "Max KB"],
                ["max_storage_gb", "Max stockage (Go)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min={0}
                  value={quotaForm[key]}
                  onChange={(e) =>
                    setQuotaForm({ ...quotaForm, [key]: Number(e.target.value) })
                  }
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={savingQuotas}>
                {savingQuotas ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Enregistrer les quotas
              </Button>
            </div>
          </form>
        </section>
      </div>
    </DashboardShell>
  );
}
