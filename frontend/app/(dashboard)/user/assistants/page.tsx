"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Bot, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { assistantChatPath } from "@/lib/chat-url";
import type { Assistant } from "@/lib/types";
import { useAuth } from "@/components/providers/auth-provider";
import { MemberShell } from "@/components/layout/member-shell";
import { EmptyState } from "@/components/layout/app-shell";

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
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((a) => {
            const href = assistantChatPath(
              a.id,
              a.organization_id || organization?.id
            );
            return (
              <Link
                key={a.id}
                href={href}
                className="group flex flex-col rounded-2xl border border-border/80 bg-card/80 p-5 shadow-sm transition-all hover:border-foreground/20 hover:shadow-md"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-muted">
                  <Bot className="size-5 text-foreground/80" />
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">
                  {a.name}
                </h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground line-clamp-3">
                  {a.description || a.welcome_message || "Assistant IA documentaire"}
                </p>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-foreground">
                  Ouvrir
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
