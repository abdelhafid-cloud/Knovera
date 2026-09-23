import Image from "next/image";
import icon from "@/assets/knovera-icon.png";
import { cn } from "@/lib/utils";

export function KnoveraIcon({ className }: { className?: string }) {
  return (
    <Image
      src={icon}
      alt=""
      className={cn("size-8 shrink-0 rounded-lg", className)}
    />
  );
}

/** Icône couleur + nom, lisible en clair et en sombre. */
export function KnoveraLogo({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
  priority?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <KnoveraIcon className={cn("size-8", iconClassName)} />
      <span className="font-semibold tracking-tight text-foreground">Knovera</span>
    </span>
  );
}
