import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useChat } from "@/context/ChatContext";
import { ChatThread } from "@/components/chat/ChatThread";

export const ChatWorkspace = ({ admin = false }) => {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const { refreshUnread } = useChat();
  const load = useCallback(async (before, signal) => {
    try {
      const { data } = await api.get("/chat/conversations", { params: before ? { before } : {}, signal });
      if (signal?.aborted) return;
      setConversations((old) => before ? [...new Map([...old, ...data.items].map((c) => [c.id, c])).values()] : [...data.items, ...old.filter((c) => !data.items.some((v) => v.id === c.id))]);
      if (before || !initialized.current) setMore(data.has_more);
      initialized.current = true;
      if (!admin && data.items.length) setSelected((value) => value || data.items[0].id);
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
    try { const { data } = await api.post("/chat/conversations"); setSelected(data.id); await load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const changed = useCallback(() => { load(); refreshUnread(); }, [load, refreshUnread]);
  return <div data-testid="chat-workspace">
    {error && <div role="alert" className="mb-3 rounded-xl border bg-card p-3" data-testid="chat-list-error"><p className="text-sm text-rose-600">{error}</p><Button variant="ghost" size="sm" onClick={() => load()} data-testid="chat-list-retry">Réessayer</Button></div>}
    {loading ? <p data-testid="chat-loading" className="p-6 text-muted-foreground">Chargement des conversations…</p> : <div className={admin ? "grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" : ""}>
      {admin && <aside className="max-h-[65vh] space-y-2 overflow-y-auto rounded-2xl border bg-card p-3" data-testid="chat-conversations">
        {conversations.length === 0 && <p className="p-3 text-sm text-muted-foreground" data-testid="chat-admin-empty">Aucune conversation pour le moment.</p>}
        {conversations.map((c) => <button type="button" key={c.id} onClick={() => setSelected(c.id)} aria-pressed={selected === c.id} data-testid={`chat-conversation-${c.id}`} className={`w-full rounded-xl border p-3 text-left transition-colors ${selected === c.id ? "border-primary bg-accent" : "border-transparent hover:bg-muted"}`}>
          <span className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{c.user_name}</span><span data-testid={`chat-unread-${c.id}`} className={c.unread_count ? "rounded-full bg-primary px-2 text-xs text-white" : "text-xs text-muted-foreground"}>{c.unread_count ? `${c.unread_count} non lus` : "Lu"}</span></span>
          <span className="block truncate text-xs text-muted-foreground">{c.user_email}</span>
          <span className="mt-2 block truncate text-sm">{c.last_message || "Nouvelle conversation"}</span>
          <time className="mt-1 block text-xs text-muted-foreground">{new Date(c.updated_at).toLocaleString("fr-FR")}</time>
        </button>)}
        {more && <Button variant="outline" size="sm" className="w-full" onClick={() => load(conversations[conversations.length - 1]?.id)} data-testid="chat-more-conversations">Voir plus</Button>}
      </aside>}
      {selected ? <ChatThread key={selected} conversationId={selected} admin={admin} onChanged={changed} /> : <div className="rounded-2xl border bg-card p-6" data-testid="chat-empty">
        <p className="text-sm text-muted-foreground">{admin ? "Sélectionnez une conversation pour répondre." : "Besoin d’aide ? Écrivez à notre équipe."}</p>
        {!admin && !error && <Button disabled={busy} onClick={start} className="mt-4 rounded-full" data-testid="chat-start">Démarrer une conversation</Button>}
      </div>}
    </div>}
  </div>;
};
