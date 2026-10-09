import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function userInitials(name?: string | null, email?: string | null) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (email?.[0] || "?").toUpperCase();
}

/** Photo si elle existe, sinon initiales générées. L’image n’est jamais obligatoire. */
export function UserAvatar({
  name,
  email,
  avatarUrl,
  className,
}: {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-9 shrink-0", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
        {userInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
