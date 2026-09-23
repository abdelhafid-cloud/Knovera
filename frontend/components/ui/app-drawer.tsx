"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AppDrawer({
  open,
  onClose,
  children,
  className,
  labelledBy,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  title?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "relative z-10 flex h-full w-full max-w-xl flex-col border-l border-border bg-card text-card-foreground shadow-2xl",
          "animate-in slide-in-from-right duration-200",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || labelledBy) && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 id={labelledBy} className="truncate text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body
  );
}
