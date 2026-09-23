"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Activity,
  BarChart3,
  Building2,
  Check,
  ChevronsUpDown,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Moon,
  Settings,
  Bot,
  Users,
  BookOpen,
  ScrollText,
  Sun,
  PanelLeftClose,
  UserRound,
  type LucideProps,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/providers/auth-provider";
import { api } from "@/lib/api";
import type { Organization } from "@/lib/types";
import { KnoveraIcon } from "@/components/brand/knovera-mark";
import { OrgLogo } from "@/components/organizations/org-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type NavLink = {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: NavLink[];
};

const SIDEBAR_KEY = "rag_sidebar_collapsed";

function isNavActive(pathname: string, href: string, exact?: boolean) {
  if (exact || href.split("/").filter(Boolean).length <= 1) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
}: {
  href: string;
  icon: ComponentType<LucideProps>;
  label: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={cn(
        "group relative flex h-9 items-center rounded-md text-sm transition-colors",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span
        className={cn(
          "truncate transition-all duration-300",
          collapsed ? "w-0 max-w-0 opacity-0 overflow-hidden" : "w-auto max-w-[160px] opacity-100"
        )}
      >
        {label}
      </span>
    </Link>
  );
}

function OrganizationSwitcher() {
  const router = useRouter();
  const { isSuperAdmin, organization, switchOrganization, refreshMe, user } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);

  const membershipOrgs = (user?.memberships || [])
    .filter((m) => m.status === "active")
    .map((m) => ({
      id: m.organization_id,
      name: m.organization_name || "Organisation",
      logo_url: m.organization_logo_url,
    }));

  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .get<Organization[]>("/api/organizations")
      .then((r) => setOrgs(r.data || []))
      .catch(() => setOrgs([]));
  }, [isSuperAdmin]);

  const selectGlobal = async () => {
    setLoading(true);
    try {
      api.setOrganizationId(null);
      await refreshMe();
      router.push("/super-admin");
    } finally {
      setLoading(false);
    }
  };

  const selectOrg = async (orgId: string) => {
    setLoading(true);
    try {
      await switchOrganization(orgId);
      router.push("/organization");
    } finally {
      setLoading(false);
    }
  };

  const list = isSuperAdmin
    ? orgs.map((o) => ({ id: o.id, name: o.name, logo_url: o.logo_url }))
    : membershipOrgs;

  // Afficher si super-admin OU plusieurs memberships
  if (!isSuperAdmin && membershipOrgs.length < 2) return null;

  const label = organization?.name || (isSuperAdmin ? "Toutes les organisations" : "Organisation");
  const currentLogo = organization?.logo_url;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          className="h-8 max-w-[240px] justify-between gap-2 font-normal"
        >
          <OrgLogo name={label} logoUrl={currentLogo} className="size-5 rounded" iconClassName="size-3" />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Organisations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isSuperAdmin ? (
          <DropdownMenuItem onClick={selectGlobal}>
            <LayoutDashboard className="size-4" />
            <span className="flex-1">Vue globale (stats)</span>
            {!organization ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ) : null}
        {isSuperAdmin ? <DropdownMenuSeparator /> : null}
        {list.length === 0 ? (
          <DropdownMenuItem disabled>Aucune organisation</DropdownMenuItem>
        ) : (
          list.map((org) => (
            <DropdownMenuItem key={org.id} onClick={() => selectOrg(org.id)}>
              <OrgLogo name={org.name} logoUrl={org.logo_url} className="size-6" iconClassName="size-3.5" />
              <span className="flex-1 truncate">{org.name}</span>
              {organization?.id === org.id ? <Check className="size-4" /> : null}
            </DropdownMenuItem>
          ))
        )}
        {isSuperAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/super-admin/organizations")}>
              Gérer les organisations…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { user, isSuperAdmin, organization, logout, permissions } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const isOrgAdmin =
    permissions.includes("org.dashboard.view") || permissions.includes("org.members.manage");

  const superGroups: NavGroup[] = [
    {
      label: "Pilotage",
      items: [
        { href: "/super-admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
        { href: "/super-admin/analytics", label: "Analytique", icon: BarChart3 },
        { href: "/super-admin/system", label: "Santé système", icon: Activity },
      ],
    },
    {
      label: "Tenants",
      items: [
        { href: "/super-admin/organizations", label: "Organisations", icon: Building2 },
        { href: "/super-admin/users", label: "Utilisateurs", icon: Users },
      ],
    },
    {
      label: "Contenu plateforme",
      items: [
        { href: "/super-admin/documents", label: "Documents", icon: FileText },
        { href: "/super-admin/knowledge-bases", label: "Knowledge bases", icon: BookOpen },
        { href: "/super-admin/assistants", label: "Assistants", icon: Bot },
        { href: "/super-admin/conversations", label: "Conversations", icon: MessageSquare },
      ],
    },
    {
      label: "Gouvernance",
      items: [
        { href: "/super-admin/audit-logs", label: "Journal d'audit", icon: ScrollText },
        { href: "/super-admin/settings", label: "Paramètres", icon: Settings },
        { href: "/user/profile", label: "Mon profil", icon: UserRound },
      ],
    },
  ];

  const orgLinks: NavLink[] = [
    { href: "/organization", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
    { href: "/organization/members", label: "Membres", icon: Users },
    { href: "/organization/documents", label: "Documents", icon: FileText },
    { href: "/organization/knowledge-bases", label: "Knowledge bases", icon: BookOpen },
    { href: "/organization/assistants", label: "Assistants", icon: Bot },
    { href: "/organization/conversations", label: "Conversations", icon: MessageSquare },
    { href: "/organization/settings", label: "Paramètres", icon: Settings },
    { href: "/user/profile", label: "Mon profil", icon: UserRound },
  ];

  const userLinks: NavLink[] = [
    { href: "/user/assistants", label: "Assistants", icon: Bot },
    { href: "/user/profile", label: "Mon profil", icon: UserRound },
  ];

  let sectionLabel = "Espace utilisateur";
  let groups: NavGroup[] | null = null;
  let links: NavLink[] = userLinks;

  if (pathname.startsWith("/super-admin") && isSuperAdmin) {
    groups = superGroups;
    sectionLabel = "Super Admin";
  } else if (pathname.startsWith("/organization") && (isOrgAdmin || isSuperAdmin)) {
    links = orgLinks;
    sectionLabel = "Organisation";
  } else if (pathname.startsWith("/user")) {
    links = userLinks;
    sectionLabel = "Espace utilisateur";
  } else if (isSuperAdmin && !organization) {
    groups = superGroups;
    sectionLabel = "Super Admin";
  } else if (isOrgAdmin || (isSuperAdmin && organization)) {
    links = orgLinks;
    sectionLabel = "Organisation";
  }

  const initials = (user?.first_name?.[0] || user?.email?.[0] || "?").toUpperCase();

  return (
    <aside
      className={cn(
        "z-30 hidden h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex",
        "transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[60px]" : "w-64"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "flex-col justify-center gap-1 px-1.5 py-2" : "gap-2 px-3"
        )}
      >
        {!collapsed && (
          <>
            <KnoveraIcon className="size-8" />
            <div className="min-w-0 flex-1 overflow-hidden transition-opacity duration-300">
              <p className="truncate text-sm font-semibold leading-none">Knovera</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {organization?.name || (isSuperAdmin ? "Console plateforme" : "Workspace")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={toggleCollapsed}
              aria-label="Réduire la sidebar"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </>
        )}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={toggleCollapsed}
            aria-label="Ouvrir la sidebar"
            title="Ouvrir"
          >
            <KnoveraIcon className="size-8" />
          </Button>
        )}
      </div>

      {/* Nav */}
      <div className={cn("flex-1 overflow-y-auto overflow-x-hidden py-3", collapsed ? "px-1.5" : "px-2.5")}>
        <p
          className={cn(
            "mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-all duration-300",
            collapsed ? "h-0 opacity-0 overflow-hidden mb-0" : "opacity-100"
          )}
        >
          {sectionLabel}
        </p>
        <nav className="flex flex-col gap-3">
          {groups
            ? groups.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  <p
                    className={cn(
                      "px-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 transition-all duration-300",
                      collapsed ? "h-0 opacity-0 overflow-hidden" : "opacity-100 mb-0.5"
                    )}
                  >
                    {group.label}
                  </p>
                  {group.items.map((item) => (
                    <NavItem
                      key={item.href}
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      collapsed={mounted ? collapsed : false}
                      active={isNavActive(pathname, item.href, item.exact)}
                    />
                  ))}
                </div>
              ))
            : (
                <div className="flex flex-col gap-1">
                  {links.map((item) => (
                    <NavItem
                      key={item.href}
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      collapsed={mounted ? collapsed : false}
                      active={isNavActive(pathname, item.href, item.exact)}
                    />
                  ))}
                </div>
              )}
        </nav>
      </div>

      {/* User footer */}
      <div className="mt-auto border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center rounded-md text-left text-sm outline-none transition-colors hover:bg-sidebar-accent",
                collapsed ? "justify-center p-1.5" : "gap-2 p-1.5"
              )}
            >
              <Avatar className="size-8 shrink-0">
                {user?.avatar_url ? (
                  <AvatarImage key={user.avatar_url} src={user.avatar_url} alt="" />
                ) : null}
                <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  "min-w-0 flex-1 overflow-hidden transition-all duration-300",
                  collapsed ? "w-0 max-w-0 opacity-0" : "opacity-100"
                )}
              >
                <p className="truncate text-xs font-medium">{user?.full_name || "Compte"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
              </div>
              {!collapsed && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.full_name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isSuperAdmin && (
              <DropdownMenuItem onClick={() => (window.location.href = "/super-admin")}>
                Vue Super Admin
              </DropdownMenuItem>
            )}
            {(isOrgAdmin || isSuperAdmin) && (
              <DropdownMenuItem onClick={() => (window.location.href = "/organization")}>
                Dashboard organisation
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => (window.location.href = "/user/profile")}>
              Mon profil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => (window.location.href = "/user/assistants")}>
              Mes assistants
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await logout();
                window.location.href = "/login";
              }}
            >
              <LogOut />
              Déconnexion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

export function AppHeader({ title, breadcrumbs = [] }: { title: string; breadcrumbs?: string[] }) {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { isSuperAdmin, permissions } = useAuth();
  const isOrgAdmin =
    permissions.includes("org.dashboard.view") || permissions.includes("org.members.manage");

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
      <div className="min-w-0 flex-1">
        {breadcrumbs.length > 0 && (
          <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, i) => (
              <span key={`${crumb}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground/40">/</span>}
                <span>{crumb}</span>
              </span>
            ))}
          </div>
        )}
        <h1 className="truncate text-sm font-semibold tracking-tight md:text-base">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        <OrganizationSwitcher />

        {isSuperAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => router.push("/super-admin/organizations")}
          >
            <Building2 className="size-3.5" />
            Organisations
          </Button>
        )}
        {isOrgAdmin && !isSuperAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => router.push("/organization")}
          >
            Organisation
          </Button>
        )}
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
      </div>
    </header>
  );
}

export function DashboardShell({
  title,
  breadcrumbs,
  children,
  actions,
}: {
  title: string;
  breadcrumbs?: string[];
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <RequireAuth>
      <div className="flex h-svh w-full overflow-hidden bg-background">
        <AppSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <AppHeader title={title} breadcrumbs={breadcrumbs} />
          <main className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
            {actions ? <div className="flex justify-end">{actions}</div> : null}
            {children}
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value?: string | number | null;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-sm font-medium text-muted-foreground">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-2xl font-semibold tabular-nums tracking-tight">
          {value ?? "—"}
        </CardTitle>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  if (!title && !description && !actions) return null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {title ? <h2 className="text-lg font-semibold tracking-tight">{title}</h2> : null}
        {description ? (
          <p className={cn("text-sm text-muted-foreground", title && "mt-1")}>{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-pulse rounded-md bg-muted" />
          <p className="text-sm text-muted-foreground">Chargement…</p>
        </div>
      </div>
    );
  }
  if (!user) return null;
  return children;
}
