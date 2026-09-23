"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { homeForUser } from "@/lib/roles";
import type { LoginResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InvitePreview = {
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  organization_name?: string;
  logo_url?: string | null;
  role_code?: string | null;
};

function RegisterForm() {
  const params = useSearchParams();
  const router = useRouter();
  const tokenFromUrl = params.get("token") || "";
  const [token, setToken] = useState(tokenFromUrl);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(!!tokenFromUrl);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tokenFromUrl) return;
    setLoadingPreview(true);
    api
      .get<InvitePreview>(`/api/auth/invitation?token=${encodeURIComponent(tokenFromUrl)}`)
      .then((r) => setPreview(r.data))
      .catch((err: Error) => setPreviewError(err.message || "Invitation invalide"))
      .finally(() => setLoadingPreview(false));
  }, [tokenFromUrl]);

  if (!tokenFromUrl && !token) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          L’inscription libre est désactivée. Un Super Admin ou un Admin doit créer votre compte.
        </p>
        <Button asChild className="w-full">
          <Link href="/login">Retour à la connexion</Link>
        </Button>
      </div>
    );
  }

  if (tokenFromUrl && loadingPreview) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tokenFromUrl && previewError) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">{previewError}</p>
        <Button asChild className="w-full" variant="outline">
          <Link href="/login">Retour à la connexion</Link>
        </Button>
      </div>
    );
  }

  const orgName = preview?.organization_name || "votre organisation";
  const greeting = preview?.first_name
    ? `Bonjour ${preview.first_name}, choisissez un mot de passe pour activer votre accès.`
    : "Choisissez un mot de passe pour activer votre accès.";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<LoginResult>("/api/auth/accept-invitation", {
        token,
        password,
      });
      if (res.data?.access_token) {
        api.setAccessToken(res.data.access_token);
        const memberships = res.data.user?.memberships || [];
        if (memberships[0]) api.setOrganizationId(memberships[0].organization_id);
      }
      toast.success("Compte activé");
      router.push(homeForUser(res.data?.user));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invitation invalide");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="flex flex-col items-center gap-3 pb-1 text-center">
        <span className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
          {preview?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.logo_url} alt="" className="size-full object-cover" />
          ) : (
            <Building2 className="size-7 text-muted-foreground" />
          )}
        </span>
        <div>
          <p className="text-base font-semibold tracking-tight">{orgName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{greeting}</p>
        </div>
      </div>

      {!tokenFromUrl ? (
        <div className="space-y-2">
          <Label htmlFor="token">Token d&apos;invitation</Label>
          <Input id="token" value={token} onChange={(e) => setToken(e.target.value)} required />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm_password">Confirmer le mot de passe</Label>
        <Input
          id="confirm_password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
        />
      </div>
      <Button className="w-full" type="submit" disabled={loading} aria-busy={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : "Activer mon compte"}
      </Button>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
