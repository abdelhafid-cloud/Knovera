"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MessageSource } from "@/lib/types";
import { cn } from "@/lib/utils";

function scorePercent(score?: number | null): string | null {
  if (score == null || Number.isNaN(score)) return null;
  const pct = score <= 1 ? score * 100 : score;
  return `${Math.round(pct)} %`;
}

function SourceRow({ s }: { s: MessageSource }) {
  const [open, setOpen] = useState(false);
  const pct = scorePercent(s.relevance_score);
  const hasExcerpt = Boolean(s.excerpt?.trim());

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium leading-snug">{s.document_name || "Document"}</p>
          <p className="text-muted-foreground">
            {s.page_number != null ? `Page ${s.page_number}` : "Page —"}
            {pct ? ` · Pertinence ${pct}` : null}
          </p>
        </div>
        {s.minio_url ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1.5 px-2.5"
            onClick={() => window.open(s.minio_url!, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="size-3.5" />
            Ouvrir
          </Button>
        ) : null}
      </div>
      {hasExcerpt ? (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            Extrait
          </button>
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap text-muted-foreground",
              !open && "line-clamp-2"
            )}
          >
            {s.excerpt}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function MessageSources({ sources }: { sources?: MessageSource[] | null }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
      <p className="text-xs font-medium text-muted-foreground">
        Pourquoi cette réponse · Sources ({sources.length})
      </p>
      {sources.map((s) => (
        <SourceRow key={s.id} s={s} />
      ))}
    </div>
  );
}
