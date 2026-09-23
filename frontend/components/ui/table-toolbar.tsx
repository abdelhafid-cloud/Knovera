"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FilterChip = {
  value: string;
  label: string;
};

type TableToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterChip[];
  activeFilter?: string;
  onFilterChange?: (value: string) => void;
  countLabel?: string;
  actions?: ReactNode;
  className?: string;
};

export function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Rechercher…",
  filters,
  activeFilter,
  onFilterChange,
  countLabel,
  actions,
  className,
}: TableToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="relative max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {filters?.map((f) => (
          <Button
            key={f.value}
            type="button"
            size="sm"
            variant={activeFilter === f.value ? "default" : "outline"}
            onClick={() => onFilterChange?.(f.value)}
          >
            {f.label}
          </Button>
        ))}
        {countLabel ? (
          <span className="ml-1 text-xs tabular-nums text-muted-foreground">{countLabel}</span>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
