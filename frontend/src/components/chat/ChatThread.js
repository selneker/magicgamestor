import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const ChatThread = ({ conversationId, admin, onChanged }) => {
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
  const send = async (e) => {
    e.preventDefault(); if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await api.post(`/chat/conversations/${conversationId}/messages`, { text: draft.trim() });
      setDraft(""); stickToBottom.current = true; await load(); onChanged();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return <section className="flex min-w-0 flex-col overflow-hidden border border-foreground bg-card" data-testid="chat-thread">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground px-3 py-2">
      <h2 className="font-display text-sm font-black uppercase tracking-tight" data-testid="chat-thread-title">{admin ? conversation?.user_name || "Client" : "Support"}</h2>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] font-black uppercase tracking-[0.1em]" onClick={() => markRead(messages).catch((e) => setError(errorMessage(e)))} data-testid="chat-mark-read">Marquer lu</Button>
    </header>
    <div ref={scroller} onScroll={() => { const el = scroller.current; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }} className="h-[45vh] min-h-[240px] space-y-3 overflow-y-auto p-4" role="log" aria-label="Messages" data-testid="chat-history">
      {more && <Button variant="outline" size="sm" onClick={() => { stickToBottom.current = false; load(messages[0]?.id); }} data-testid="chat-older-messages">Messages précédents</Button>}
      {loading && <p data-testid="chat-thread-loading" className="text-sm text-muted-foreground">Chargement…</p>}
      {!loading && messages.length === 0 && <p data-testid="chat-no-messages" className="text-sm text-muted-foreground">Envoyez votre premier message.</p>}
      {messages.map((m) => <article key={m.id} data-testid={`chat-message-${m.id}`} className={`max-w-[85%] border px-3 py-2 ${m.sender_role === role ? "ml-auto border-[#0A0A0A] bg-primary text-[#0A0A0A]" : "mr-auto border-foreground/20 bg-muted text-foreground"}`}>
        <p className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] opacity-70">{m.sender_role === role ? "Vous" : m.sender_role === "admin" ? "Admin" : conversation?.user_name}</p>
        <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{m.text}</p>
        <p className="mt-1 text-xs opacity-80"><time>{new Date(m.created_at).toLocaleString("fr-FR")}</time>{m.sender_role === role && <span data-testid={`chat-message-status-${m.id}`}> · {m.read ? "Lu" : "Envoyé"}</span>}</p>
      </article>)}
    </div>
    {error && <div className="px-4 pb-3" role="alert" data-testid="chat-thread-error"><p className="text-sm text-rose-600">{error}</p><Button variant="ghost" size="sm" data-testid="chat-thread-retry" onClick={() => load()}>Réessayer</Button></div>}
    <form onSubmit={send} className="border-t border-foreground p-3">
      <label htmlFor={`message-${conversationId}`} className="sr-only">Votre message</label>
      <Textarea id={`message-${conversationId}`} data-testid="chat-message-input" maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Votre message…" className="min-h-16 resize-none rounded-none border-foreground" />
      <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground" data-testid="chat-message-length">{draft.length}/2000</span><Button type="submit" disabled={busy || !draft.trim()} className="rounded-none text-[11px] font-black uppercase tracking-[0.1em]" data-testid="chat-send"><Send className="mr-2 h-4 w-4" />{busy ? "Envoi…" : "Envoyer"}</Button></div>
    </form>
  </section>;
};
