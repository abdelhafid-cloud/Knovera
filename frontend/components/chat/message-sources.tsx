"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MessageSource } from "@/lib/types";

export function MessageSources({ sources }: { sources?: MessageSource[] | null }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
      <p className="text-xs font-medium text-muted-foreground">
        {sources.length > 1 ? "Sources" : "Source"}
      </p>
      {sources.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between gap-3 rounded-xl bg-background/60 px-3 py-2 text-xs"
        >
          <p className="min-w-0 truncate font-medium">
            {s.document_name || "Document"}
          </p>
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
      ))}
    </div>
  );
}
