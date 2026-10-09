"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Menu,
  MessageSquarePlus,
  PanelLeft,
  PanelLeftClose,
  Send,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import type { Assistant, Conversation, Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSources } from "@/components/chat/message-sources";
import { ProviderBadge } from "@/components/ui/storage-badges";
import { OrgLogo } from "@/components/organizations/org-logo";
import { Badge } from "@/components/ui/badge";

type ChatResponse = {
  conversation: Conversation;
  message: Message;
  user_message: Message;
};

function ChatExperience() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const { loading: authLoading, user, refreshMe, isSuperAdmin } = useAuth();
  const assistantsHref =
    isSuperAdmin || user?.is_super_admin ? "/super-admin/assistants" : "/user/assistants";

  const assistantId = String(params.assistantId || "");
  const orgFromUrl = search.get("org");

  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [booting, setBooting] = useState(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (orgFromUrl) {
      api.setOrganizationId(orgFromUrl);
    }
  }, [orgFromUrl]);

  useEffect(() => {
    if (authLoading) return;
    api.hydrateFromStorage();
    if (!api.accessToken) {
      const next = `/chat/${assistantId}${orgFromUrl ? `?org=${orgFromUrl}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, router, assistantId, orgFromUrl]);

  const loadConversations = useCallback(async () => {
    const r = await api.get<Conversation[]>("/api/conversations");
    const mine = (r.data || []).filter((c) => c.assistant_id === assistantId);
    setConversations(mine);
  }, [assistantId]);

  useEffect(() => {
    if (authLoading || !assistantId) return;
    api.hydrateFromStorage();
    if (!api.accessToken) return;

    let cancelled = false;
    (async () => {
      setBooting(true);
      try {
        if (orgFromUrl) api.setOrganizationId(orgFromUrl);
        const me = user ? true : !!(await refreshMe());
        if (!me && !api.accessToken) {
          const next = `/chat/${assistantId}${orgFromUrl ? `?org=${orgFromUrl}` : ""}`;
          router.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        const [aRes] = await Promise.all([
          api.get<Assistant>(`/api/assistants/${assistantId}`),
          loadConversations(),
        ]);
        if (!cancelled) setAssistant(aRes.data);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Impossible de charger l’assistant");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, assistantId, loadConversations, refreshMe, orgFromUrl, router, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const openConversation = async (id: string) => {
    setConversationId(id);
    setMobileSidebar(false);
    try {
      const r = await api.get<Conversation>(`/api/conversations/${id}`);
      setMessages(r.data.messages || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const newChat = () => {
    setConversationId("");
    setMessages([]);
    setMobileSidebar(false);
    textareaRef.current?.focus();
  };

  const removeConversation = async (id: string) => {
    if (!confirm("Supprimer cette conversation ?")) return;
    try {
      await api.delete(`/api/conversations/${id}`);
      if (conversationId === id) newChat();
      await loadConversations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const sendNonStream = async (question: string) => {
    const res = await api.post<ChatResponse>("/api/chat", {
      assistant_id: assistantId,
      conversation_id: conversationId || undefined,
      message: question,
    });
    setConversationId(res.data.conversation.id);
    setMessages((prev) => [
      ...prev.filter((m) => !String(m.id).startsWith("tmp-") && !String(m.id).startsWith("stream-")),
      res.data.user_message,
      res.data.message,
    ]);
    await loadConversations();
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !assistantId || loading) return;
    const question = input.trim();
    setInput("");
    const streamId = `stream-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "user", content: question, sources: [] },
      { id: streamId, role: "assistant", content: "", sources: [] },
    ]);
    setLoading(true);
    setStreaming(false);
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;

    let usedStream = false;
    try {
      await api.streamChat(
        "/api/chat/stream",
        {
          assistant_id: assistantId,
          conversation_id: conversationId || undefined,
          message: question,
        },
        (event) => {
          const type = String(event.type || "");
          if (type === "token" && typeof event.text === "string") {
            usedStream = true;
            setStreaming(true);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId ? { ...m, content: m.content + event.text } : m
              )
            );
          }
          if (type === "meta") {
            if (event.conversation_id) {
              setConversationId(String(event.conversation_id));
            }
            const um = event.user_message as Message | undefined;
            if (um?.id) {
              setMessages((prev) =>
                prev.map((m) => (String(m.id).startsWith("tmp-") ? um : m))
              );
            }
          }
          if (type === "done") {
            const msg = event.message as Message | undefined;
            if (msg) {
              setMessages((prev) =>
                prev.map((m) => (m.id === streamId ? { ...msg, role: "assistant" } : m))
              );
            }
          }
          if (type === "error") {
            throw new Error(String(event.message || "Erreur chat"));
          }
        },
        ac.signal
      );
      await loadConversations();
    } catch (err) {
      if (ac.signal.aborted) return;
      if (!usedStream) {
        try {
          await sendNonStream(question);
          return;
        } catch (fallbackErr) {
          toast.error(fallbackErr instanceof Error ? fallbackErr.message : "Erreur chat");
          setMessages((prev) =>
            prev.filter(
              (m) => !String(m.id).startsWith("tmp-") && !String(m.id).startsWith("stream-")
            )
          );
          return;
        }
      }
      toast.error(err instanceof Error ? err.message : "Erreur chat");
      setMessages((prev) =>
        prev.filter(
          (m) => !String(m.id).startsWith("tmp-") && !String(m.id).startsWith("stream-")
        )
      );
    } finally {
      setLoading(false);
      setStreaming(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const welcome = assistant?.welcome_message || "Posez une question sur vos documents indexés.";
  const banner = /^#[0-9A-Fa-f]{6}$/.test(assistant?.banner_color || "")
    ? assistant!.banner_color!
    : "#3B82F6";
  const bannerText = (() => {
    const n = parseInt(banner.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#0f172a" : "#ffffff";
  })();
  const onDarkBanner = bannerText === "#ffffff";
  const bannerGhost = onDarkBanner
    ? "text-white hover:bg-white/15 hover:text-white"
    : "text-slate-900 hover:bg-black/10 hover:text-slate-900";
  const bannerAction = onDarkBanner
    ? "border-transparent bg-white text-slate-900 shadow-sm hover:bg-slate-100 hover:text-slate-900"
    : "border-transparent bg-slate-900 text-white shadow-sm hover:bg-slate-800 hover:text-white";
  const bannerChip = onDarkBanner
    ? "border-transparent !bg-white !text-slate-900 shadow-sm [&_svg]:!text-slate-700 [&_span]:!opacity-100"
    : "border-transparent !bg-slate-900 !text-white shadow-sm [&_svg]:!text-white [&_span]:!opacity-100";

  const renderSidebar = () => (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-border bg-muted/30">
      <div className="flex min-w-0 items-center gap-2 border-b border-border p-3">
        <Button className="min-w-0 flex-1 justify-start gap-2 overflow-hidden" variant="outline" onClick={newChat}>
          <MessageSquarePlus className="size-4 shrink-0" />
          <span className="truncate">Nouvelle discussion</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden shrink-0 md:inline-flex"
          onClick={() => setSidebarOpen(false)}
          aria-label="Réduire"
        >
          <PanelLeftClose className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={() => setMobileSidebar(false)}
          aria-label="Fermer"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Historique
        </p>
        {conversations.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">Aucune conversation.</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => openConversation(c.id)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 pr-9 text-left text-sm transition-colors",
                    conversationId === c.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  )}
                >
                  <span className="line-clamp-1">{c.title || "Sans titre"}</span>
                </button>
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
                  onClick={() => removeConversation(c.id)}
                  aria-label="Supprimer"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-border bg-gradient-to-br from-primary/5 to-transparent p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <OrgLogo
              name={assistant?.organization_name || assistant?.name}
              logoUrl={assistant?.organization_logo_url}
              className="size-8 rounded-lg"
              iconClassName="size-4"
            />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-foreground line-clamp-1">
              {assistant?.name || "Assistant"}
            </div>
            <div className="mt-0.5 line-clamp-2">
              {assistant?.description || "RAG documentaire"}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <ProviderBadge provider={assistant?.llm_provider} model={assistant?.model} />
        </div>
      </div>
    </aside>
  );

  if (authLoading || booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <div
        className={cn(
          "hidden h-full w-[260px] shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out md:block",
          sidebarOpen ? "md:w-[260px]" : "md:w-0"
        )}
      >
        {renderSidebar()}
      </div>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden",
          mobileSidebar ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-300 ease-in-out",
            mobileSidebar ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setMobileSidebar(false)}
        />
        <div
          className={cn(
            "relative z-10 h-full w-[min(85vw,280px)] max-w-[85vw] overflow-hidden bg-background shadow-xl transition-transform duration-300 ease-in-out",
            mobileSidebar ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {renderSidebar()}
        </div>
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex min-h-14 shrink-0 items-center gap-2 border-b px-3 py-2 md:h-14 md:px-4 md:py-0"
          style={{ backgroundColor: banner, borderColor: banner }}
        >
          <Button
            variant="ghost"
            size="icon"
            className={cn("md:hidden", bannerGhost)}
            onClick={() => setMobileSidebar(true)}
            aria-label="Menu"
          >
            <Menu className="size-4" />
          </Button>
          {!sidebarOpen ? (
            <Button
              variant="ghost"
              size="icon"
              className={cn("hidden md:inline-flex", bannerGhost)}
              onClick={() => setSidebarOpen(true)}
              aria-label="Ouvrir la sidebar"
            >
              <PanelLeft className="size-4" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-sm font-semibold tracking-tight"
              style={{ color: bannerText }}
            >
              {assistant?.name || "Assistant"}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <ProviderBadge
                provider={assistant?.llm_provider}
                model={assistant?.model}
                className={bannerChip}
              />
              {assistant?.is_active === false ? (
                <Badge className={cn("text-[10px]", bannerChip)}>Inactif</Badge>
              ) : (
                <Badge className="border-transparent bg-emerald-500 text-[10px] font-semibold text-white shadow-sm">
                  Actif
                </Badge>
              )}
            </div>
          </div>
          <Button asChild variant="ghost" size="sm" className={cn("hidden sm:inline-flex", bannerGhost)}>
            <Link href={assistantsHref}>
              <ArrowLeft className="size-4" />
              Assistants
            </Link>
          </Button>
          <Button variant="outline" size="sm" className={bannerAction} onClick={newChat}>
            Nouveau
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6">
            {messages.length === 0 && !loading ? (
              <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
                <OrgLogo
                  name={assistant?.organization_name || assistant?.name}
                  logoUrl={assistant?.organization_logo_url}
                  className="mb-4 size-14 rounded-2xl border border-primary/25"
                  iconClassName="size-7"
                />
                <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                  {assistant?.name || "Assistant"}
                </h2>
                <p className="mt-3 max-w-md text-sm text-muted-foreground">{welcome}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  <ProviderBadge provider={assistant?.llm_provider} model={assistant?.model} />
                  <Badge variant="info" className="text-[10px]">
                    RAG
                  </Badge>
                </div>
              </div>
            ) : null}

            {messages.map((m) => (
              <div
                key={m.id}
                className={cn("flex w-full", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[92%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed md:max-w-[85%]",
                    m.role === "user"
                      ? "bg-foreground text-background"
                      : "bg-muted/70 text-foreground"
                  )}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2">
                      <ReactMarkdown>{m.content || (streaming && String(m.id).startsWith("stream-") ? "…" : "")}</ReactMarkdown>
                      {streaming && String(m.id).startsWith("stream-") ? (
                        <span
                          className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-foreground/70"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}

                  {m.role === "assistant" && !String(m.id).startsWith("stream-") ? (
                    <div className="mt-2 flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground"
                        onClick={() => {
                          navigator.clipboard.writeText(m.content);
                          toast.success("Copié");
                        }}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}

                  {m.sources && m.sources.length > 0 ? (
                    <MessageSources sources={m.sources} />
                  ) : null}
                </div>
              </div>
            ))}

            {loading && !streaming ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                L’assistant réfléchit…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)]">
          <form onSubmit={send} className="mx-auto w-full max-w-3xl px-3 py-2 md:px-6 md:py-4">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/40 p-2 shadow-sm">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Message…"
                disabled={loading || !assistant}
                className="max-h-[180px] min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              <Button
                type="submit"
                size="icon"
                className="size-10 shrink-0 rounded-xl"
                disabled={loading || !assistant || !input.trim()}
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
            <p className="mt-1.5 line-clamp-2 text-center text-[11px] leading-snug text-muted-foreground">
              Entrée pour envoyer, Maj+Entrée pour une ligne. Réponses basées sur les documents indexés.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function StandaloneChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ChatExperience />
    </Suspense>
  );
}
