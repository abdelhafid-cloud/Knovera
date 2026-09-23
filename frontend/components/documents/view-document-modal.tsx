"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
} from "lucide-react";
import { AppModal } from "@/components/ui/app-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

type Props = {
  open: boolean;
  document: DocumentItem | null;
  detailPath: string | null;
  onClose: () => void;
};

const statusVariant: Record<string, "success" | "warning" | "secondary" | "danger" | "outline"> = {
  indexed: "success",
  processing: "warning",
  pending: "secondary",
  failed: "danger",
};

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

export function ViewDocumentModal({ open, document, detailPath, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentItem | null>(null);

  useEffect(() => {
    if (!open || !document || !detailPath) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setDetail(null);
      try {
        const r = await api.get<DocumentItem>(detailPath);
        if (!cancelled) setDetail(r.data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Impossible de charger les informations");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, document, detailPath]);

  if (!document) return null;

  const d = detail || document;
  const mimeLabel = d.mime_type?.includes("pdf")
    ? "PDF"
    : d.mime_type?.includes("word")
      ? "Word"
      : d.mime_type?.includes("sheet")
        ? "Excel"
        : d.mime_type?.includes("text")
          ? "Texte"
          : d.mime_type || "Fichier";

  return (
    <AppModal
      open={open}
      onClose={onClose}
      labelledBy="view-doc-title"
      className="max-w-md"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 id="view-doc-title" className="text-lg font-semibold tracking-tight">
          Fiche document
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Fermer
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
              <FileText className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold leading-snug">{d.name}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant[d.status] || "outline"}>{d.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {mimeLabel} · {formatBytes(d.size_bytes)}
                </span>
              </div>
            </div>
          </div>

          {d.minio_url ? (
            <Button
              type="button"
              className="w-full"
              onClick={() => window.open(d.minio_url!, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-4" />
              Ouvrir le document
            </Button>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">
              Document indisponible dans le stockage
            </p>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <MetaItem
              label="Créé"
              value={d.created_at ? new Date(d.created_at).toLocaleString("fr-FR") : "—"}
            />
            <MetaItem
              label="Indexé"
              value={d.indexed_at ? new Date(d.indexed_at).toLocaleString("fr-FR") : "—"}
            />
            {d.organization_name ? (
              <MetaItem label="Organisation" value={d.organization_name} />
            ) : null}
            <MetaItem label="Fichier" value={d.file_name || d.name || "—"} />
          </div>

          {(d.cloud_url || d.source_url) && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Liens associés
              </p>
              <div className="flex flex-wrap gap-2">
                {d.cloud_url ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(d.cloud_url!, "_blank", "noopener,noreferrer")}
                  >
                    <Cloud className="size-4" />
                    Cloud
                  </Button>
                ) : null}
                {d.source_url ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(d.source_url!, "_blank", "noopener,noreferrer")}
                  >
                    <Link2 className="size-4" />
                    Source
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          {d.error_message ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              {d.error_message}
            </div>
          ) : null}
        </div>
      )}
    </AppModal>
  );
}
