"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  Copy,
  Loader2,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeft,
  Send,
  Trash2,
  X,
  ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import type { Assistant, Conversation, Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSources } from "@/components/chat/message-sources";
import Link from "next/link";

type ChatResponse = {
  conversation: Conversation;
  message: Message;
  user_message: Message;
};

function ChatExperience() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const { loading: authLoading, user, refreshMe } = useAuth();

  const assistantId = String(params.assistantId || "");
  const orgFromUrl = search.get("org");

  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
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

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !assistantId || loading) return;
    const question = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "user", content: question, sources: [] },
    ]);
    setLoading(true);
    try {
      const res = await api.post<ChatResponse>("/api/chat", {
        assistant_id: assistantId,
        conversation_id: conversationId || undefined,
        message: question,
      });
      setConversationId(res.data.conversation.id);
      setMessages((prev) => [
        ...prev.filter((m) => !String(m.id).startsWith("tmp-")),
        res.data.user_message,
        res.data.message,
      ]);
      await loadConversations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur chat");
      setMessages((prev) => prev.filter((m) => !String(m.id).startsWith("tmp-")));
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const welcome = assistant?.welcome_message || "Posez une question sur vos documents indexés.";

  const sidebar = (
    <aside
      className={cn(
        "flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-muted/30",
        !sidebarOpen && "hidden md:hidden"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Button className="flex-1 justify-start gap-2" variant="outline" onClick={newChat}>
          <MessageSquarePlus className="size-4" />
          Nouvelle discussion
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => setSidebarOpen(false)}
          aria-label="Réduire"
        >
          <PanelLeftClose className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
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
      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        <div className="font-medium text-foreground line-clamp-1">{assistant?.name || "Assistant"}</div>
        <div className="mt-0.5 line-clamp-2">{assistant?.description || "RAG documentaire"}</div>
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
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className={cn("hidden h-full md:flex", sidebarOpen ? "md:flex" : "md:hidden")}>
        {sidebar}
      </div>

      {/* Mobile drawer */}
      {mobileSidebar ? (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileSidebar(false)} />
          <div className="relative z-10 h-full">{sidebar}</div>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileSidebar(true)}
            aria-label="Menu"
          >
            <Menu className="size-4" />
          </Button>
          {!sidebarOpen ? (
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              onClick={() => setSidebarOpen(true)}
              aria-label="Ouvrir la sidebar"
            >
              <PanelLeft className="size-4" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {assistant?.name || "Assistant"}
            </h1>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/user/assistants">
              <ArrowLeft className="size-4" />
              Assistants
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={newChat}>
            Nouveau
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6">
            {messages.length === 0 && !loading ? (
              <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
                <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                  {assistant?.name || "Assistant"}
                </h2>
                <p className="mt-3 max-w-md text-sm text-muted-foreground">{welcome}</p>
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
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}

                  {m.role === "assistant" ? (
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

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                L’assistant réfléchit…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background/80 backdrop-blur">
          <form onSubmit={send} className="mx-auto w-full max-w-3xl px-4 py-3 md:px-6 md:py-4">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/40 p-2 shadow-sm">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Message… (Entrée pour envoyer, Maj+Entrée pour une ligne)"
                disabled={loading || !assistant}
                className="max-h-[180px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
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
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Réponses basées sur les documents indexés de la knowledge base liée.
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
