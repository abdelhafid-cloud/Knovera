"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  FileSearch,
  Lock,
  MessageSquareQuote,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import { KnoveraLogo } from "@/components/brand/knovera-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./landing.css";

function Reveal({
  children,
  className,
  delay,
}: {
  children: ReactNode;
  className?: string;
  delay?: 1 | 2 | 3;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          io.disconnect();
        }
      },
      { threshold: 0.18 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "landing-reveal",
        delay === 1 && "landing-reveal-delay-1",
        delay === 2 && "landing-reveal-delay-2",
        delay === 3 && "landing-reveal-delay-3",
        className
      )}
    >
      {children}
    </div>
  );
}

function Section({
  id,
  children,
  className,
  tone = "default",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: "default" | "muted" | "inverse";
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative px-6 py-20 md:py-28",
        tone === "muted" && "bg-muted/40",
        tone === "inverse" && "bg-foreground text-background",
        className
      )}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

function SectionHeading({
  title,
  description,
  light,
}: {
  title: string;
  description: string;
  light?: boolean;
}) {
  return (
    <div className="max-w-2xl">
      <h2
        className={cn(
          "font-display text-3xl font-medium tracking-tight md:text-4xl",
          light ? "text-background" : "text-foreground"
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "mt-3 text-base leading-relaxed md:text-lg",
          light ? "text-background/70" : "text-muted-foreground"
        )}
      >
        {description}
      </p>
    </div>
  );
}

const TECH = [
  { name: "Cohere Embed", mark: "Co" },
  { name: "Qdrant", mark: "Qd" },
  { name: "MinIO", mark: "Mi" },
  { name: "Redis", mark: "Re" },
  { name: "RQ Workers", mark: "RQ" },
  { name: "Docker", mark: "Dk" },
  { name: "LLM RAG", mark: "AI" },
  { name: "Vector Search", mark: "VS" },
];

const PIPELINE = [
  { title: "Ingestion", text: "PDF, DOCX et textes uploadés vers MinIO, isolés par organisation." },
  { title: "Chunking", text: "Découpage intelligent, métadonnées de page et traçabilité." },
  { title: "Embeddings", text: "Vecteurs multilingues via Cohere, stockés dans Qdrant." },
  { title: "Réponse citée", text: "LLM + retrieval top-k avec sources affichées dans le chat." },
];

const CAPABILITIES = [
  {
    icon: Building2,
    title: "Multi-tenant strict",
    text: "Chaque organisation possède ses documents, assistants et membres — sans fuite croisée.",
  },
  {
    icon: MessageSquareQuote,
    title: "Citations vérifiables",
    text: "Chaque réponse pointe vers le fichier et la page d’origine pour auditer la confiance.",
  },
  {
    icon: ShieldCheck,
    title: "RBAC invitation-only",
    text: "Super Admin, Org Admin et User avec permissions granulaires et journal d’audit.",
  },
  {
    icon: Workflow,
    title: "Pipeline asynchrone",
    text: "Indexation Redis/RQ : upload immédiat, traitement en arrière-plan, statut live.",
  },
];

const ROLES = [
  {
    title: "Super Admin",
    text: "Pilotage plateforme, santé système, analytics, tenants et gouvernance globale.",
  },
  {
    title: "Org Admin",
    text: "Membres, knowledge bases, assistants et paramètres de l’entreprise.",
  },
  {
    title: "Collaborateur",
    text: "Chat avec assistants autorisés, historique et réponses sourcées.",
  },
];

export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* 1 — Hero */}
      <div className="relative isolate min-h-svh">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 90% 60% at 70% 10%, oklch(0.5 0.134 242.749 / 0.16), transparent 55%), radial-gradient(ellipse 50% 40% at 10% 80%, oklch(0.72 0.08 200 / 0.12), transparent), linear-gradient(180deg, transparent 60%, var(--background))",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.4] landing-pulse"
          style={{
            backgroundImage:
              "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage: "radial-gradient(ellipse at 60% 30%, black 15%, transparent 65%)",
          }}
        />

        <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <a href="#top" className="flex items-center">
            <KnoveraLogo priority iconClassName="size-9" className="text-sm" />
          </a>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#produit" className="hover:text-foreground transition-colors">
              Produit
            </a>
            <a href="#pipeline" className="hover:text-foreground transition-colors">
              Pipeline
            </a>
            <a href="#stack" className="hover:text-foreground transition-colors">
              Stack
            </a>
            <a href="#securite" className="hover:text-foreground transition-colors">
              Sécurité
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Connexion</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/login">Accéder</Link>
            </Button>
          </div>
        </header>

        <main
          id="top"
          className="relative z-10 mx-auto flex min-h-[calc(100svh-4.5rem)] w-full max-w-6xl flex-col justify-center gap-12 px-6 pb-20 pt-6 lg:flex-row lg:items-center lg:gap-16"
        >
          <div className="max-w-xl">
            <KnoveraLogo priority iconClassName="size-14 sm:size-16" className="text-2xl sm:text-3xl" />
            <h1 className="mt-5 text-xl font-medium tracking-tight text-foreground/90 sm:text-2xl">
              Des réponses fiables, uniquement depuis vos documents.
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
              Plateforme SaaS multi-tenant : knowledge bases isolées, assistants contrôlés,
              citations traçables pour vos équipes.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/login">
                  Accéder à la plateforme
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="#produit">Découvrir le produit</Link>
              </Button>
            </div>
          </div>

          <div className="relative hidden w-full max-w-lg flex-1 lg:block">
            {/* Halo rotatif derrière le mock — ne chevauche pas le chat */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 size-[120%] -translate-x-1/2 -translate-y-1/2"
            >
              <div className="landing-orbit absolute inset-0 rounded-full border border-dashed border-primary/25" />
              <div className="landing-orbit-reverse absolute inset-[8%] rounded-full border border-primary/15" />
            </div>
            <div className="landing-float relative z-10 overflow-hidden rounded-2xl border border-border/80 bg-background/80 shadow-[0_40px_80px_-40px_oklch(0.4_0.08_242_/_0.45)] backdrop-blur">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <span className="size-2 rounded-full bg-muted-foreground/35" />
                <span className="size-2 rounded-full bg-muted-foreground/35" />
                <span className="size-2 rounded-full bg-muted-foreground/35" />
                <span className="ml-2 text-xs text-muted-foreground">Assistant · Conformité</span>
              </div>
              <div className="space-y-4 p-5">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground">
                  Quelle clause s’applique aux sous-traitants hors UE ?
                </div>
                <div className="max-w-[92%] space-y-3 rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3 text-sm">
                  <p className="leading-relaxed text-foreground/90">
                    Le DPA indexé impose un transfert uniquement via SCC + évaluation d’impact…
                  </p>
                  <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    Source · DPA_Fournisseurs_v3.pdf — p.9
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <div className="h-10 flex-1 rounded-md border border-input bg-background" />
                  <div className="h-10 w-24 rounded-md bg-primary/90" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* 2 — Tech marquee */}
      <section className="border-y border-border bg-muted/30 py-4 overflow-hidden" aria-label="Technologies">
        <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Propulsé par une stack production
        </p>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-muted/30 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-muted/30 to-transparent" />
          <div className="landing-marquee-track flex w-max items-center gap-6 pr-6">
            {[...TECH, ...TECH, ...TECH, ...TECH].map((t, i) => (
              <div
                key={`${t.name}-${i}`}
                className="flex shrink-0 items-center gap-2.5 text-sm font-medium text-foreground/80"
              >
                <span className="flex size-8 items-center justify-center rounded-md border border-border bg-background text-[10px] font-bold tracking-tight text-primary">
                  {t.mark}
                </span>
                <span className="whitespace-nowrap">{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 — Problem / promise */}
      <Section id="promesse">
        <Reveal>
          <SectionHeading
            title="Finis les chatbots hors contexte."
            description="Les LLM génériques inventent. Knovera ancre chaque réponse dans vos knowledge bases — avec isolation tenant et audit."
          />
        </Reveal>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {[
            { k: "Isolation", v: "Données cloisonnées par organisation, collections Qdrant filtrées." },
            { k: "Preuve", v: "Sources affichées : document, page, score de pertinence." },
            { k: "Contrôle", v: "Qui invite, qui indexe, qui parle à quel assistant." },
          ].map((item, i) => (
            <Reveal key={item.k} delay={(i + 1) as 1 | 2 | 3}>
              <div className="border-t border-border pt-5">
                <p className="text-sm font-semibold tracking-wide text-primary">{item.k}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.v}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 4 — Product showcase */}
      <Section id="produit" tone="muted">
        <Reveal>
          <SectionHeading
            title="Une console pensée pour l’entreprise."
            description="Super Admin pour la plateforme, Org Admin pour le tenant, collaborateurs pour le chat — une UX cohérente shadcn."
          />
        </Reveal>
        <Reveal delay={1} className="mt-12">
          <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-background p-5 lg:col-span-7 min-h-[280px]">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Dashboard plateforme
              </p>
              <div className="mt-6 grid grid-cols-3 gap-3">
                {["Orgs", "Users", "Docs"].map((l, i) => (
                  <div key={l} className="rounded-xl border border-border p-3">
                    <p className="text-[11px] text-muted-foreground">{l}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{[24,180,12][i]}k</p>
                    <div
                      className="mt-3 h-1.5 rounded-full bg-primary/20"
                      style={{ width: `${40 + i * 20}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-5 h-24 rounded-xl border border-dashed border-border bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
            </div>
            <div className="flex flex-col gap-4 lg:col-span-5">
              <div className="flex-1 rounded-2xl border border-border bg-background p-5">
                <FileSearch className="size-5 text-primary" />
                <p className="mt-3 font-medium">Knowledge bases</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Collections documentaires isolées, indexation live, statuts visibles.
                </p>
              </div>
              <div className="flex-1 rounded-2xl border border-border bg-background p-5">
                <Users className="size-5 text-primary" />
                <p className="mt-3 font-medium">Invitations & rôles</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Onboarding sécurisé : pas d’inscription publique sauvage.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* 5 — Pipeline */}
      <Section id="pipeline">
        <Reveal>
          <SectionHeading
            title="Du fichier à la réponse sourcée."
            description="Un pipeline RAG complet : stockage objet, embeddings, recherche vectorielle, génération contrôlée."
          />
        </Reveal>
        <div className="mt-14 grid gap-0 md:grid-cols-4">
          {PIPELINE.map((step, i) => (
            <Reveal key={step.title} delay={Math.min(i + 1, 3) as 1 | 2 | 3}>
              <div className="relative border-l border-border pl-5 md:border-l-0 md:border-t md:pl-0 md:pt-5 md:pr-6">
                <span className="absolute -left-[5px] top-0 size-2.5 rounded-full bg-primary md:left-0 md:-top-[5px]" />
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  0{i + 1}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 6 — Capabilities */}
      <Section tone="muted">
        <Reveal>
          <SectionHeading
            title="Ce que vos équipes utilisent au quotidien."
            description="Pas une démo gadget : des modules opérationnels pour indexer, gouverner et interroger."
          />
        </Reveal>
        <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={(Math.min(i, 2) + 1) as 1 | 2 | 3}>
              <div className="flex gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                  <c.icon className="size-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 7 — Stack deep dive */}
      <Section id="stack" tone="inverse">
        <Reveal>
          <SectionHeading
            light
            title="Une architecture moderne, pas une boîte noire."
            description="Frontend Next.js TypeScript, API Flask, Postgres pour le métier, Qdrant pour les vecteurs, Cohere pour les embeddings, MinIO pour les fichiers."
          />
        </Reveal>
        <Reveal delay={1} className="mt-12">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Frontend", "Next.js 15 · React 19 · shadcn/ui · Tailwind"],
              ["API", "Flask · JWT · RBAC · rate limiting"],
              ["Données", "PostgreSQL · SQLAlchemy · migrations"],
              ["Vecteurs", "Qdrant · collections filtrées par org"],
              ["IA", "Cohere Embed · LLM configurable"],
              ["Infra", "Docker · Redis/RQ · MinIO S3"],
            ].map(([title, detail]) => (
              <div
                key={title}
                className="rounded-xl border border-background/15 bg-background/5 px-4 py-4 backdrop-blur-sm"
              >
                <p className="text-sm font-semibold text-background">{title}</p>
                <p className="mt-1.5 text-sm text-background/65">{detail}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Section>

      {/* 8 — Security */}
      <Section id="securite">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <SectionHeading
              title="Sécurité et gouvernance dès le premier jour."
              description="Accès par invitation, rôles explicites, audit trail, séparation des contextes d’organisation."
            />
            <ul className="mt-8 space-y-4">
              {[
                "JWT court + refresh, cookies sécurisés",
                "Permissions par action (documents, assistants, membres)",
                "Journal d’audit consultable par Super Admin",
                "Health checks DB / Redis / Qdrant / MinIO",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={2}>
            <div className="relative overflow-hidden rounded-2xl border border-border bg-muted/30 p-8">
              <Sparkles className="size-6 text-primary" />
              <p className="mt-4 font-display text-2xl font-medium tracking-tight">
                Vos documents ne quittent jamais votre périmètre métier.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Le retrieval est borné à l’organisation active. Un Super Admin peut basculer de
                contexte pour support — jamais mélanger les indexes.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-3 text-center">
                <div className="rounded-xl border border-border bg-background px-3 py-4">
                  <p className="text-2xl font-semibold tabular-nums">3</p>
                  <p className="mt-1 text-xs text-muted-foreground">niveaux de rôle</p>
                </div>
                <div className="rounded-xl border border-border bg-background px-3 py-4">
                  <p className="text-2xl font-semibold tabular-nums">100%</p>
                  <p className="mt-1 text-xs text-muted-foreground">réponses sourçables</p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* 9 — Roles / personas */}
      <Section tone="muted">
        <Reveal>
          <SectionHeading
            title="Trois expériences, une plateforme."
            description="Chaque persona a son espace — sans surcharger l’interface des autres."
          />
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {ROLES.map((role, i) => (
            <Reveal key={role.title} delay={(i + 1) as 1 | 2 | 3}>
              <div className="h-full border-t-2 border-primary/60 pt-5">
                <h3 className="text-lg font-semibold">{role.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{role.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 10 — Final CTA */}
      <Section className="pb-10 md:pb-14">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border px-8 py-14 text-center md:px-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse 70% 80% at 50% 100%, oklch(0.5 0.134 242.749 / 0.18), transparent 60%)",
              }}
            />
            <p className="relative font-display text-3xl font-medium tracking-tight md:text-5xl">
              Prêt à déployer Knovera ?
            </p>
            <p className="relative mx-auto mt-4 max-w-lg text-muted-foreground">
              Connectez-vous avec un compte existant, ou activez votre invitation pour rejoindre
              votre organisation.
            </p>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/login">
                  Se connecter
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/login">Se connecter</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </Section>

      <footer className="border-t border-border bg-muted/30 px-6 py-12">
        <div className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="max-w-sm">
            <KnoveraLogo iconClassName="size-8" className="text-sm" />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Knowledge de nouvelle génération. Des réponses fiables, limitées aux documents de
              chaque organisation.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Plateforme
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a href="#produit" className="text-foreground/80 hover:text-foreground">
                  Produit
                </a>
              </li>
              <li>
                <a href="#securite" className="text-foreground/80 hover:text-foreground">
                  Sécurité
                </a>
              </li>
              <li>
                <a href="#pipeline" className="text-foreground/80 hover:text-foreground">
                  Fonctionnement
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Accès
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link href="/login" className="text-foreground/80 hover:text-foreground">
                  Connexion
                </Link>
              </li>
              <li>
                <Link href="/register" className="text-foreground/80 hover:text-foreground">
                  Activer une invitation
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mx-auto mt-10 flex w-full max-w-6xl border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">© 2026 Knovera. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
}
