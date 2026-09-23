"use client";

import { cn, formatBytes } from "@/lib/utils";
import type { QuotaItem } from "@/lib/types";

export function QuotaBar({
  item,
  className,
}: {
  item: QuotaItem;
  className?: string;
}) {
  const pct = Math.min(100, item.percent);
  const usedLabel =
    item.key === "storage_bytes" ? formatBytes(item.used) : String(item.used);
  const limitLabel =
    item.key === "storage_bytes" ? formatBytes(item.limit) : String(item.limit);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="capitalize text-muted-foreground">{item.label}</span>
        <span
          className={cn(
            "tabular-nums font-medium",
            item.over && "text-destructive",
            item.warning && !item.over && "text-amber-600 dark:text-amber-400"
          )}
        >
          {usedLabel} / {limitLabel}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            item.over
              ? "bg-destructive"
              : item.warning
                ? "bg-amber-500"
                : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
