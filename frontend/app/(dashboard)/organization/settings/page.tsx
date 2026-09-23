"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { api } from "@/lib/api";
import type { Organization } from "@/lib/types";
import { DashboardShell } from "@/components/layout/app-shell";
import { OrgLogo } from "@/components/organizations/org-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function OrgSettingsPage() {
  const { organization, refreshMe } = useAuth();
  const [name, setName] = useState(organization?.name || "");
  const [logoUrl, setLogoUrl] = useState<string | null>(organization?.logo_url || null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(organization?.name || "");
    setLogoUrl(organization?.logo_url || null);
  }, [organization?.name, organization?.logo_url]);

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
      </div>
    </DashboardShell>
  );
}
