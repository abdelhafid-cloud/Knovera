import { Database, HardDrive, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const VECTOR_TONES = ["soft", "info", "muted"] as const;

export function VectorDbBadge({
  number,
  label,
  className,
}: {
  number?: number | null;
  label?: string | null;
  className?: string;
}) {
  if (number == null && !label) {
    return <span className="text-muted-foreground">—</span>;
  }
  const tone = VECTOR_TONES[Math.abs(Number(number || 0)) % VECTOR_TONES.length];
  return (
    <Badge variant={tone} className={cn("gap-1 font-semibold tabular-nums", className)}>
      <Database className="size-3" />
      {label || `Collection #${number}`}
    </Badge>
  );
}

export function MinioBucketBadge({
  bucket,
  className,
}: {
  bucket?: string | null;
  className?: string;
}) {
  if (!bucket) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="info" className={cn("max-w-[180px] gap-1 font-mono text-[10px]", className)}>
      <HardDrive className="size-3 shrink-0" />
      <span className="truncate">{bucket}</span>
    </Badge>
  );
}

export function CollectionBadge({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="muted" className={cn("max-w-[200px] gap-1 font-mono text-[10px]", className)}>
      <span className="truncate">{name}</span>
    </Badge>
  );
}

export function ProviderBadge({
  provider,
  model,
  className,
}: {
  provider?: string | null;
  model?: string | null;
  className?: string;
}) {
  const p = (provider || "openai").toLowerCase();
  const variant =
    p === "anthropic" ? "soft" : p === "openrouter" ? "info" : ("muted" as const);
  return (
    <Badge variant={variant} className={cn("gap-1", className)}>
      <Cpu className="size-3" />
      <span className="capitalize">{p}</span>
      {model ? <span className="opacity-70">· {model}</span> : null}
    </Badge>
  );
}
