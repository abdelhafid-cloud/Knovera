"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FileText, Loader2 } from "lucide-react";
import { AppModal } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/utils";

export type UploadDocumentMeta = {
  name: string;
  cloud_url: string;
  source_url: string;
};

type Props = {
  open: boolean;
  file: File | null;
  uploading?: boolean;
  onClose: () => void;
  onConfirm: (meta: UploadDocumentMeta) => void | Promise<void>;
};

export function UploadDocumentModal({ open, file, uploading = false, onClose, onConfirm }: Props) {
  const [name, setName] = useState("");
  const [cloudUrl, setCloudUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  useEffect(() => {
    if (!open || !file) return;
    setName(file.name);
    setCloudUrl("");
    setSourceUrl("");
  }, [open, file]);

  if (!file) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onConfirm({
      name: trimmed,
      cloud_url: cloudUrl.trim(),
      source_url: sourceUrl.trim(),
    });
  };

  return (
    <AppModal open={open} onClose={uploading ? () => undefined : onClose} labelledBy="upload-doc-title" className="max-w-lg">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <h2 id="upload-doc-title" className="text-lg font-semibold tracking-tight">
            Confirmer l’upload
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Vérifiez le nom et renseignez éventuellement les liens.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-background border border-border">
            <FileText className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {formatBytes(file.size)}
              {file.type ? ` · ${file.type}` : ""}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="upload-doc-name">Nom du document</Label>
          <Input
            id="upload-doc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={500}
            disabled={uploading}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="upload-doc-cloud">
            Lien cloud <span className="font-normal text-muted-foreground">(optionnel)</span>
          </Label>
          <Input
            id="upload-doc-cloud"
            type="text"
            inputMode="url"
            placeholder="https://s3… / Drive / SharePoint…"
            value={cloudUrl}
            onChange={(e) => setCloudUrl(e.target.value)}
            disabled={uploading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="upload-doc-source">
            Lien source <span className="font-normal text-muted-foreground">(optionnel)</span>
          </Label>
          <Input
            id="upload-doc-source"
            type="text"
            inputMode="url"
            placeholder="https://… origine du document"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            disabled={uploading}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={uploading}>
            Annuler
          </Button>
          <Button type="submit" disabled={uploading || !name.trim()}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirmer l’upload
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
