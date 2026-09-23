"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  Bot,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/providers/auth-provider";
import { RequireAuth } from "@/components/layout/app-shell";
import { OrgLogo } from "@/components/organizations/org-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isMemberOnly, isOrgAdminRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/user/assistants", label: "Assistants", icon: Bot },
  { href: "/user/profile", label: "Mon compte", icon: Settings },
] as const;

export function MemberShell({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, organization, logout, permissions, isSuperAdmin } = useAuth();

  // Si un admin atterrit ici, le renvoyer vers son dashboard
  useEffect(() => {
    if (isSuperAdmin || user?.is_super_admin) {
      router.replace("/super-admin");
      return;
    }
    if (!isMemberOnly(permissions, isSuperAdmin, user)) {
      router.replace("/organization");
    }
  }, [isSuperAdmin, permissions, router, user]);

  const initials = (user?.first_name?.[0] || user?.email?.[0] || "?").toUpperCase();
  const orgLabel = organization?.name || "Espace";

  return (
    <RequireAuth>
      <div className="flex min-h-svh flex-col bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/60 via-background to-background">
        <header className="sticky top-0 z-30 border-b border-border/80 bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
            <Link href="/user/assistants" className="flex min-w-0 items-center gap-2.5">
              <OrgLogo
                name={orgLabel}
                logoUrl={organization?.logo_url}
                className="size-8 rounded-lg"
                iconClassName="size-4"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-none tracking-tight">
                  {orgLabel}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Assistants
                </p>
              </div>
            </Link>

            <nav className="ml-2 hidden items-center gap-1 sm:flex">
              {NAV.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors",
                      active
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="relative size-8"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="Basculer le thème"
              >
                <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-full p-0.5 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Avatar className="size-8">
                      {user?.avatar_url ? (
                        <AvatarImage key={user.avatar_url} src={user.avatar_url} alt="" />
                      ) : null}
                      <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">{user?.full_name || "Compte"}</p>
                      <p className="text-xs text-muted-foreground">{user?.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/user/assistants")}>
                    <Bot className="size-4" />
                    Assistants
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/user/profile")}>
                    <UserRound className="size-4" />
                    Mon compte
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      await logout();
                      window.location.href = "/login";
                    }}
                  >
                    <LogOut className="size-4" />
                    Déconnexion
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Mobile nav */}
          <div className="flex gap-1 border-t border-border/60 px-4 py-1.5 sm:hidden">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          {title ? (
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
          ) : null}
          {children}
        </main>
      </div>
    </RequireAuth>
  );
}

/** Redirige les membres hors des dashboards admin. */
export function RequireAdminArea({
  children,
  mode,
}: {
  children: ReactNode;
  mode: "org" | "super";
}) {
  const router = useRouter();
  const { user, loading, permissions, isSuperAdmin } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (mode === "super" && !isSuperAdmin && !user.is_super_admin) {
      router.replace(homePathForGuard(permissions, isSuperAdmin, user));
      return;
    }
    if (mode === "org" && isMemberOnly(permissions, isSuperAdmin, user)) {
      router.replace("/user/assistants");
    }
  }, [loading, user, permissions, isSuperAdmin, mode, router]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </div>
    );
  }

  if (!user) return null;

  if (mode === "super" && !isSuperAdmin && !user.is_super_admin) return null;
  if (mode === "org" && isMemberOnly(permissions, isSuperAdmin, user)) return null;

  return <>{children}</>;
}

function homePathForGuard(
  permissions: string[],
  isSuperAdmin: boolean,
  user: { is_super_admin?: boolean; memberships?: { status: string; role?: { code: string | null } | null }[] }
) {
  if (isSuperAdmin || user.is_super_admin) return "/super-admin";
  if (isOrgAdminRole(permissions, false)) return "/organization";
  if (user.memberships?.some((m) => m.status === "active" && m.role?.code === "org_admin")) {
    return "/organization";
  }
  return "/user/assistants";
}
