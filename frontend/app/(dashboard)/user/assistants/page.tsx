"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { assistantChatPath } from "@/lib/chat-url";
import type { Assistant } from "@/lib/types";
import { useAuth } from "@/components/providers/auth-provider";
import { MemberShell } from "@/components/layout/member-shell";
import { EmptyState } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { ProviderBadge } from "@/components/ui/storage-badges";
import { OrgLogo } from "@/components/organizations/org-logo";

export default function UserAssistantsPage() {
  const { organization } = useAuth();
  const [items, setItems] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<Assistant[]>("/api/assistants")
      .then((r) => setItems(r.data || []))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <MemberShell title="Vos assistants">
      <p className="mb-8 -mt-4 text-sm text-muted-foreground">
        Sélectionnez un assistant pour démarrer une conversation.
      </p>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucun assistant disponible"
          description="Demandez à un administrateur de vous donner accès."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((a, idx) => {
            const href = assistantChatPath(
              a.id,
              a.organization_id || organization?.id
            );
            const tones = [
              "from-primary/15 border-primary/25",
              "from-sky-500/12 border-sky-500/25",
              "from-indigo-500/12 border-indigo-500/25",
            ];
            const tone = tones[idx % tones.length];
            return (
              <Link
                key={a.id}
                href={href}
                className={`group flex flex-col rounded-2xl border bg-gradient-to-br via-card to-card p-5 shadow-sm transition-all hover:shadow-md ${tone}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <OrgLogo
                    name={a.organization_name || a.name}
                    logoUrl={a.organization_logo_url}
                    className="size-11 rounded-xl"
                    iconClassName="size-5"
                  />
                  <Badge variant={a.is_active === false ? "secondary" : "success"} className="text-[10px]">
                    {a.is_active === false ? "Inactif" : "Actif"}
                  </Badge>
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">{a.name}</h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground line-clamp-3">
                  {a.description || a.welcome_message || "Assistant IA documentaire"}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <ProviderBadge provider={a.llm_provider} model={a.model} />
                </div>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">
                  Ouvrir le chat
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </MemberShell>
  );
}
