"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";
import { AppModal } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { getCroppedImageBlob } from "@/lib/crop-image";
import { cn } from "@/lib/utils";

type AvatarCropperProps = {
  imageSrc: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void | Promise<void>;
};

export function AvatarCropper({ imageSrc, open, onCancel, onConfirm }: AvatarCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.2);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onCropComplete = useCallback(
    async (_area: Area, pixels: Area) => {
      setCroppedAreaPixels(pixels);
      try {
        const blob = await getCroppedImageBlob(imageSrc, pixels, 256, "image/jpeg", 0.85);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch {
        /* preview optional */
      }
    },
    [imageSrc]
  );

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, 512, "image/jpeg", 0.92);
      const file = new File([blob], `avatar-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onConfirm(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => !busy && onCancel()}
      labelledBy="avatar-crop-title"
      className="max-w-lg flex flex-col overflow-hidden p-0"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id="avatar-crop-title" className="text-sm font-semibold">
          Recadrer la photo
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Zoomez sur le visage, puis validez. Seule la zone du cercle est envoyée.
        </p>
      </div>

      <div className="relative h-72 w-full bg-muted sm:h-80">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          restrictPosition
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <div className="space-y-3 border-t border-border px-4 py-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className={cn(
                "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              )}
              disabled={busy}
            />
          </div>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Aperçu recadré"
              className="size-12 shrink-0 rounded-full border border-border object-cover"
            />
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Annuler
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={busy || !croppedAreaPixels}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Valider le recadrage"}
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
