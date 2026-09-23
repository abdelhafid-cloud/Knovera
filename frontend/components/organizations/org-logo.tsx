"use client";

import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  name?: string | null;
  logoUrl?: string | null;
  className?: string;
  iconClassName?: string;
};

/** Logo org avec fallback icône Building2. */
export function OrgLogo({ name, logoUrl, className, iconClassName }: Props) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted",
        className
      )}
      title={name || undefined}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={name || "Logo"} className="size-full object-cover" />
      ) : (
        <Building2 className={cn("size-3.5 text-muted-foreground", iconClassName)} />
      )}
    </span>
  );
}
