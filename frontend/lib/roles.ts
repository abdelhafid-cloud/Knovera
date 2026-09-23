import type { User } from "@/lib/types";

export function isOrgAdminRole(
  permissions: string[] = [],
  isSuperAdmin = false
): boolean {
  if (isSuperAdmin) return true;
  return (
    permissions.includes("org.dashboard.view") ||
    permissions.includes("org.members.manage")
  );
}

/** Membre simple (pas super-admin, pas org-admin). */
export function isMemberOnly(
  permissions: string[] = [],
  isSuperAdmin = false,
  user?: User | null
): boolean {
  if (isSuperAdmin || user?.is_super_admin) return false;
  if (isOrgAdminRole(permissions, false)) return false;
  // Fallback login payload (permissions pas encore hydratées)
  const roles = (user?.memberships || [])
    .filter((m) => m.status === "active")
    .map((m) => m.role?.code);
  if (roles.length > 0 && roles.every((c) => c === "org_member" || !c)) {
    return true;
  }
  if (roles.some((c) => c === "org_admin")) return false;
  return !isOrgAdminRole(permissions, false);
}

export function homeForUser(
  user: User | null | undefined,
  options?: { next?: string | null; permissions?: string[]; isSuperAdmin?: boolean }
): string {
  const next = options?.next;
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;

  const isSa = !!(options?.isSuperAdmin || user?.is_super_admin);
  if (isSa) return "/super-admin";

  const perms = options?.permissions || [];
  if (isOrgAdminRole(perms, false)) return "/organization";
  if (user?.memberships?.some((m) => m.status === "active" && m.role?.code === "org_admin")) {
    return "/organization";
  }
  return "/user/assistants";
}
