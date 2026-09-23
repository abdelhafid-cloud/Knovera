"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { FileSearch, MessageSquareQuote, ShieldCheck } from "lucide-react";
import { KnoveraLogo } from "@/components/brand/knovera-mark";
import { cn } from "@/lib/utils";

type AuthSplitShellProps = {
  children: ReactNode;
};

export function AuthSplitShell({ children }: AuthSplitShellProps) {
  const pathname = usePathname();
  const mode = pathname?.startsWith("/register") ? "register" : "login";
  const formOnRight = mode === "register";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-8">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-background shadow-sm md:h-[560px]">
        <div
          className={cn(
            "relative z-10 flex flex-col justify-center bg-background p-6 sm:p-8 lg:p-10",
            "md:absolute md:inset-y-0 md:w-1/2",
            "transition-[left,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            formOnRight ? "md:left-1/2" : "md:left-0"
          )}
        >
          <div className="mx-auto w-full max-w-[360px]">
            <div className="mb-6 flex items-center md:hidden">
              <KnoveraLogo iconClassName="size-8" className="text-sm" />
            </div>

            {mode === "login" ? (
              <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight">Bon retour</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Connectez-vous à votre espace Knovera.
                </p>
              </div>
            ) : null}

            <div
              key={mode}
              className="animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-both"
            >
              {children}
            </div>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>Pas d’inscription libre — contactez votre administrateur.</>
              ) : (
                <>
                  Déjà un compte ?{" "}
                  <Link
                    href="/login"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Se connecter
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>

        <aside
          className={cn(
            "relative hidden overflow-hidden md:flex md:flex-col md:justify-between bg-muted/60 p-8 lg:p-10",
            "md:absolute md:inset-y-0 md:w-1/2",
            "transition-[left] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            formOnRight ? "md:left-0" : "md:left-1/2"
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 80% 60% at 20% 20%, oklch(0.5 0.134 242.749 / 0.18), transparent 55%), radial-gradient(ellipse 50% 40% at 90% 80%, oklch(0.65 0.06 200 / 0.15), transparent), linear-gradient(160deg, transparent, oklch(0.97 0.001 106 / 0.5))",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              maskImage: "radial-gradient(ellipse at 40% 40%, black 10%, transparent 70%)",
            }}
          />

          <div className="relative z-10">
            <KnoveraLogo iconClassName="size-9" className="text-sm" />
          </div>

          <div className="relative z-10 space-y-6" key={mode}>
            <p className="font-display text-3xl font-medium leading-tight tracking-tight lg:text-4xl">
              Accès contrôlé,
              <br />
              multi-tenant.
            </p>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Aucune inscription publique. Les utilisateurs sont ajoutés par le Super Admin ou
              l’Admin de l’organisation.
            </p>
            <ul className="space-y-3">
              {[
                { icon: ShieldCheck, text: "Comptes créés par Super Admin / Admin" },
                { icon: FileSearch, text: "Premier membre d’une org = Admin" },
                { icon: MessageSquareQuote, text: "User : accès chat & assistants" },
              ].map((item) => (
                <li key={item.text} className="flex items-start gap-3 text-sm text-foreground/85">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/80">
                    <item.icon className="size-4 text-primary" />
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative z-10 text-xs text-muted-foreground">
            Cohere · Qdrant · MinIO · Redis
          </p>
        </aside>
      </div>

      <p className="mt-6 max-w-md text-center text-xs text-muted-foreground">
        Plateforme invitation-only / provisioning par administrateurs.
      </p>
    </div>
  );
}
