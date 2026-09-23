"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AppModal } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DocumentItem } from "@/lib/types";

export type EditDocumentMeta = {
  name: string;
  cloud_url: string;
  source_url: string;
};

type Props = {
  open: boolean;
  document: DocumentItem | null;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (meta: EditDocumentMeta) => void | Promise<void>;
};

export function EditDocumentModal({
  open,
  document,
  saving = false,
  onClose,
  onConfirm,
}: Props) {
  const [name, setName] = useState("");
  const [cloudUrl, setCloudUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  useEffect(() => {
    if (!open || !document) return;
    setName(document.name || "");
    setCloudUrl(document.cloud_url || "");
    setSourceUrl(document.source_url || "");
  }, [open, document]);

  if (!document) return null;

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
    <AppModal
      open={open}
      onClose={saving ? () => undefined : onClose}
      labelledBy="edit-doc-title"
      className="max-w-lg"
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <h2 id="edit-doc-title" className="text-lg font-semibold tracking-tight">
            Modifier le document
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mettez à jour le nom et les liens associés.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-doc-name">Nom du document</Label>
          <Input
            id="edit-doc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={500}
            disabled={saving}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-doc-cloud">
            Lien cloud <span className="font-normal text-muted-foreground">(optionnel)</span>
          </Label>
          <Input
            id="edit-doc-cloud"
            type="text"
            inputMode="url"
            placeholder="https://s3… / Drive / SharePoint…"
            value={cloudUrl}
            onChange={(e) => setCloudUrl(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-doc-source">
            Lien source <span className="font-normal text-muted-foreground">(optionnel)</span>
          </Label>
          <Input
            id="edit-doc-source"
            type="text"
            inputMode="url"
            placeholder="https://… origine du document"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Enregistrer
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
