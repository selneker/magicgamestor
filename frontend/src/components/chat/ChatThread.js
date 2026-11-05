import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/context/LanguageContext";

export const ChatThread = ({ conversationId, admin, onChanged, onBack }) => {
  const { t } = useLang();
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const scroller = useRef(null);
  const stickToBottom = useRef(true);
  const composer = useRef(null);
  const role = admin ? "admin" : "customer";
  const markRead = useCallback(async (batch) => {
    const ids = batch.filter((m) => m.sender_role !== role && !m.read).map((m) => m.id);
    if (!ids.length || document.hidden) return;
    await api.post(`/chat/conversations/${conversationId}/read`, { message_ids: ids.slice(-100) });
    setMessages((old) => old.map((m) => ids.includes(m.id) ? { ...m, read: true } : m));
    onChanged();
  }, [conversationId, role, onChanged]);
  const load = useCallback(async (before, signal) => {
    try {
      const { data } = await api.get(`/chat/conversations/${conversationId}/messages`, { params: before ? { before } : {}, signal });
      if (signal?.aborted) return;
      setConversation(data.conversation);
      setMessages((old) => [...new Map([...old, ...data.messages].map((m) => [m.id, m])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)));
      if (before || !initialized.current) setMore(data.has_more);
      initialized.current = true;
      setLoading(false); setError("");
      if (!before && stickToBottom.current) await markRead(data.messages);
    } catch (e) { if (!signal?.aborted) { setError(errorMessage(e)); setLoading(false); } }
  }, [conversationId, markRead]);
  useEffect(() => {
    const controller = new AbortController();
    let timer, running = false;
    const poll = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      if (!document.hidden) await load(null, controller.signal);
      running = false;
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); poll(); } };
    poll(); document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);
  useEffect(() => { if (stickToBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [messages]);
  // Admin (MGS-FE-ADMIN-20261105-02) : le composer reste au-dessus du clavier —
  // visualViewport donne la hauteur masquée par le clavier (iOS ne réduit pas
  // le viewport layout quand le clavier s'ouvre).
  useEffect(() => {
    if (!admin || !window.visualViewport) return;
    const vv = window.visualViewport;
    const sync = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--chat-kb", `${hidden}px`);
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.style.setProperty("--chat-kb", "0px");
    };
  }, [admin]);
  // Textarea auto-extensible : 1 ligne au repos, 4 lignes maximum (admin).
  useEffect(() => {
    const el = composer.current;
    if (!admin || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft, admin, loading]);
  const send = async (e) => {
    e.preventDefault(); if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await api.post(`/chat/conversations/${conversationId}/messages`, { text: draft.trim() });
      setDraft(""); stickToBottom.current = true; await load(); onChanged();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return <section className={admin ? "flex h-full min-w-0 flex-col overflow-hidden bg-card md:rounded-[12px] md:border" : "flex min-w-0 flex-col overflow-hidden rounded-[12px] border bg-card"} data-testid="chat-thread">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div className="flex min-w-0 items-center gap-1">
        {admin && onBack && (
          <button type="button" onClick={onBack} aria-label={t("common.back")} data-testid="chat-thread-back" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-muted md:hidden">
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
        <h2 className="truncate font-display text-sm font-semibold tracking-tight" data-testid="chat-thread-title">{admin ? conversation?.user_name || t("chat.client") : t("chat.support")}</h2>
      </div>
      <Button size="sm" variant="ghost" className="h-11 px-3 text-[10px] font-medium uppercase tracking-[0.1em] md:h-7 md:px-2" onClick={() => markRead(messages).catch((e) => setError(errorMessage(e)))} data-testid="chat-mark-read">{t("chat.markRead")}</Button>
    </header>
    <div ref={scroller} onScroll={() => { const el = scroller.current; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }} className={`space-y-3 overflow-y-auto p-4 ${admin ? "min-h-0 flex-1" : "h-[45vh] min-h-[240px]"}`} role="log" aria-label={t("chat.history")} data-testid="chat-history">
      {more && <Button variant="outline" size="sm" onClick={() => { stickToBottom.current = false; load(messages[0]?.id); }} data-testid="chat-older-messages">{t("chat.older")}</Button>}
      {loading && <p data-testid="chat-thread-loading" className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {!loading && messages.length === 0 && <p data-testid="chat-no-messages" className="text-sm text-muted-foreground">{t("chat.firstMessage")}</p>}
      {messages.map((m) => { const own = m.sender_role === role; return <article key={m.id} data-testid={`chat-message-${m.id}`} className={`max-w-[85%] rounded-[12px] border px-3 py-2 ${own ? "ml-auto border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]" : "mr-auto bg-muted text-foreground"}`}>
        {/* Libellé et date : couleur pleine (pas d'opacité) pour rester >= 4.5:1
            sur la bulle — encre atténuée sur lime, token admin sur bg-muted. */}
        <p className={`mb-1 text-[10px] font-medium uppercase tracking-[0.12em] ${own ? "text-[#0A0A0A]/80" : "text-[color:var(--admin-ink-muted)]"}`}>{own ? t("chat.you") : m.sender_role === "admin" ? t("chat.adminRole") : conversation?.user_name}</p>
        <p className="whitespace-pre-wrap break-words text-sm font-normal leading-relaxed [overflow-wrap:anywhere]">{m.text}</p>
        <p className={`mt-1 text-[11px] font-normal ${own ? "text-[#0A0A0A]/80" : "text-[color:var(--admin-ink-muted)]"}`}><time>{new Date(m.created_at).toLocaleString("fr-FR")}</time>{own && <span data-testid={`chat-message-status-${m.id}`}> · {m.read ? t("chat.read") : t("chat.sent")}</span>}</p>
      </article>; })}
    </div>
    {error && <div className="px-4 pb-3" role="alert" data-testid="chat-thread-error"><p className="text-sm text-rose-600">{error}</p><Button variant="ghost" size="sm" data-testid="chat-thread-retry" onClick={() => load()}>{t("chat.retry")}</Button></div>}
    <form onSubmit={send} className={`border-t p-3 ${admin ? "flex-none pb-[max(env(safe-area-inset-bottom),var(--chat-kb,0px))]" : ""}`}>
      <label htmlFor={`message-${conversationId}`} className="sr-only">{t("chat.yourMessage")}</label>
      <Textarea ref={composer} id={`message-${conversationId}`} data-testid="chat-message-input" maxLength={2000} rows={admin ? 1 : undefined} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("chat.placeholder")} className={`${admin ? "min-h-11 max-h-[132px] placeholder:text-[color:var(--admin-ink-muted)]" : "min-h-16"} resize-none rounded-[10px] font-normal`} />
      <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] font-normal text-muted-foreground" data-testid="chat-message-length">{draft.length}/2000</span>
        {admin ? <button type="submit" disabled={busy || !draft.trim()} aria-label={busy ? t("chat.sending") : t("chat.send")} data-testid="chat-send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-primary text-[#0A0A0A] transition disabled:opacity-40">
          <Send className="h-5 w-5" strokeWidth={2} />
        </button> : <Button type="submit" disabled={busy || !draft.trim()} className="text-[11px] font-semibold uppercase tracking-[0.08em]" data-testid="chat-send"><Send className="mr-2 h-4 w-4" />{busy ? t("chat.sending") : t("chat.send")}</Button>}
      </div>
    </form>
  </section>;
};
