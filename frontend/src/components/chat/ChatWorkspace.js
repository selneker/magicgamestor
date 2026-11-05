import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useChat } from "@/context/ChatContext";
import { useLang } from "@/context/LanguageContext";
import { ChatThread } from "@/components/chat/ChatThread";

export const ChatWorkspace = ({ admin = false }) => {
  const { t } = useLang();
  const [conversations, setConversations] = useState([]);
  const [selectedState, setSelectedState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const { refreshUnread } = useChat();
  // Admin : la conversation ouverte vit dans l'URL (/admin/messages?c=<id>) —
  // le bouton retour du navigateur ramène à la liste (MGS-FE-ADMIN-20261105-02).
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = admin ? searchParams.get("c") : selectedState;
  const select = useCallback((id) => {
    if (admin) setSearchParams(id ? { c: id } : {});
    setSelectedState(id);
  }, [admin, setSearchParams]);
  const load = useCallback(async (before, signal) => {
    try {
      const { data } = await api.get("/chat/conversations", { params: before ? { before } : {}, signal });
      if (signal?.aborted) return;
      setConversations((old) => before ? [...new Map([...old, ...data.items].map((c) => [c.id, c])).values()] : [...data.items, ...old.filter((c) => !data.items.some((v) => v.id === c.id))]);
      if (before || !initialized.current) setMore(data.has_more);
      initialized.current = true;
      if (!admin && data.items.length) setSelectedState((value) => value || data.items[0].id);
      setError(""); setLoading(false);
    } catch (e) { if (!signal?.aborted) { setError(errorMessage(e)); setLoading(false); } }
  }, [admin]);
  useEffect(() => {
    const controller = new AbortController();
    let timer, running = false;
    const poll = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      if (!document.hidden) await load(null, controller.signal);
      running = false;
      if (!controller.signal.aborted) timer = setTimeout(poll, 10000);
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); poll(); } };
    poll(); document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);
  const start = async () => {
    setBusy(true);
    try { const { data } = await api.post("/chat/conversations"); select(data.id); await load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const changed = useCallback(() => { load(); refreshUnread(); }, [load, refreshUnread]);
  return <div data-testid="chat-workspace">
    {error && <div role="alert" className="mb-3 rounded-xl border bg-card p-3" data-testid="chat-list-error"><p className="text-sm text-rose-600">{error}</p><Button variant="ghost" size="sm" onClick={() => load()} data-testid="chat-list-retry">{t("chat.retry")}</Button></div>}
    {loading ? <p data-testid="chat-loading" className="p-6 text-muted-foreground">{t("chat.loadingConversations")}</p> : <div className={admin ? "md:grid md:h-[var(--chat-h,auto)] md:grid-cols-[300px_minmax(0,1fr)] md:gap-4" : ""}>
      {admin && <aside data-testid="chat-conversations" className={`space-y-2 rounded-2xl border bg-card p-3 md:h-full md:min-h-0 md:overflow-y-auto ${selected ? "hidden md:block" : ""}`}>
        {conversations.length === 0 && <p className="p-3 text-sm text-muted-foreground" data-testid="chat-admin-empty">{t("chat.empty")}</p>}
        {conversations.map((c) => { const sel = selected === c.id; const unread = c.unread_count > 0; return <button type="button" key={c.id} onClick={() => select(c.id)} aria-pressed={sel} data-testid={`chat-conversation-${c.id}`} className={`w-full border-l-[3px] p-3 text-left transition-colors ${sel ? "border-l-primary bg-muted" : "border-l-transparent hover:bg-muted"}`}>
          {/* Conversation sélectionnée : barre lime 3px à gauche + fond surélevé.
              Non lu : nom en gras + pastille lime. Lu : atténué (--admin-ink-muted). */}
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {unread && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" data-testid={`chat-unread-dot-${c.id}`} />}
              <span className={`truncate ${unread ? "font-bold text-foreground" : sel ? "text-foreground" : "font-semibold text-[color:var(--admin-ink-muted)]"}`}>{c.user_name}</span>
            </span>
            {unread ? <span data-testid={`chat-unread-${c.id}`} aria-label={t("admin.chatUnread", { count: c.unread_count })} className="inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-primary px-1.5 text-[11px] font-black text-[#0A0A0A]">{c.unread_count}</span>
              : <span data-testid={`chat-unread-${c.id}`} className={`shrink-0 text-xs ${sel ? "text-foreground" : "text-[color:var(--admin-ink-muted)]"}`}>{t("chat.read")}</span>}
          </span>
          <span className={`block truncate text-xs ${sel ? "text-foreground" : "text-[color:var(--admin-ink-muted)]"}`}>{c.user_email}</span>
          <span className={`mt-2 block truncate text-sm ${sel || unread ? "text-foreground" : "text-[color:var(--admin-ink-muted)]"}`}>{c.last_message || t("chat.newConversation")}</span>
          <time className={`mt-1 block text-xs ${sel ? "text-foreground" : "text-[color:var(--admin-ink-muted)]"}`}>{new Date(c.updated_at).toLocaleString("fr-FR")}</time>
        </button>; })}
        {more && <Button variant="outline" size="sm" className="w-full" onClick={() => load(conversations[conversations.length - 1]?.id)} data-testid="chat-more-conversations">{t("common.seeMore")}</Button>}
      </aside>}
      {selected ? <div data-testid="chat-thread-panel" className={admin ? "fixed inset-0 z-50 flex flex-col bg-background md:relative md:inset-auto md:z-auto" : ""}>
        <ChatThread key={selected} conversationId={selected} admin={admin} onChanged={changed} onBack={admin ? () => select(null) : undefined} />
      </div> : <div className={`rounded-2xl border bg-card p-6 ${admin ? "hidden md:block" : ""}`} data-testid="chat-empty">
        <p className="text-sm text-muted-foreground">{admin ? t("chat.selectPrompt") : t("chat.needHelp")}</p>
        {!admin && !error && <Button disabled={busy} onClick={start} className="mt-4 rounded-full" data-testid="chat-start">{t("chat.start")}</Button>}
      </div>}
    </div>}
  </div>;
};
