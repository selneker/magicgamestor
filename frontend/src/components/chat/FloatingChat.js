import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircle, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";
import { Button } from "@/components/ui/button";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

const SIZE = 56, MARGIN = 12, KEY = "mgs-chat-fab";
const safeBottom = () => { const v = getComputedStyle(document.documentElement).getPropertyValue("--sab"); return parseInt(v, 10) || 0; };
const isMobile = () => window.innerWidth < 768;
// Mobile keeps the button above the liquid-glass bottom nav; desktop uses the plain viewport.
const bounds = () => ({ minX: MARGIN, maxX: window.innerWidth - SIZE - MARGIN, minY: MARGIN + 64, maxY: window.innerHeight - SIZE - MARGIN - safeBottom() - (isMobile() ? 88 : 0) });
const clamp = (p) => { const b = bounds(); return { x: Math.min(Math.max(p.x, b.minX), b.maxX), y: Math.min(Math.max(p.y, b.minY), b.maxY) }; };
const defaultPos = () => clamp({ x: Infinity, y: Infinity });
const loadPos = () => { try { const p = JSON.parse(localStorage.getItem(KEY)); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? clamp(p) : defaultPos(); } catch (_) { return defaultPos(); } };

export const FloatingChat = () => {
  const { user, isAdmin } = useAuth();
  const { count, panelOpen, setPanelOpen } = useChat();
  const { pathname } = useLocation();
  const [pos, setPos] = useState(loadPos);
  const drag = useRef(null);
  useEffect(() => { const onResize = () => setPos((p) => clamp(p)); window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize); }, []);
  useEffect(() => { if (panelOpen && isMobile()) { const prev = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = prev; }; } }, [panelOpen]);
  useEffect(() => { setPanelOpen(false); }, [pathname, setPanelOpen]);
  if (pathname.startsWith("/admin") || pathname === "/chat" || isAdmin) return null;

  const onPointerDown = (e) => { drag.current = { startX: e.clientX, startY: e.clientY, origin: pos, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX, dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.current.moved = true;
    if (drag.current.moved) setPos(clamp({ x: drag.current.origin.x + dx, y: drag.current.origin.y + dy }));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { moved } = drag.current; drag.current = null;
    if (!moved) return setPanelOpen(!panelOpen);
    const b = bounds();
    const snapped = clamp({ x: pos.x + SIZE / 2 < window.innerWidth / 2 ? b.minX : b.maxX, y: pos.y });
    setPos(snapped); localStorage.setItem(KEY, JSON.stringify(snapped));
  };

  return <>
    <button type="button" data-testid="floating-chat-button" aria-label={`Chat${count ? `, ${count} messages non lus` : ""}`} aria-expanded={panelOpen}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ left: pos.x, top: pos.y, width: SIZE, height: SIZE, touchAction: "none" }}
      className="fixed z-50 flex cursor-grab select-none items-center justify-center rounded-full bg-primary text-white shadow-[0_10px_30px_hsl(var(--primary)/.45)] transition-[transform,box-shadow] duration-200 hover:scale-105 active:cursor-grabbing active:scale-95">
      {panelOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      {count > 0 && !panelOpen && <span data-testid="floating-chat-unread" className="absolute -right-1 -top-1 min-w-[22px] rounded-full bg-rose-500 px-1.5 text-center text-xs font-bold leading-[22px] text-white ring-2 ring-background">{count}</span>}
    </button>
    {panelOpen && <section role="dialog" aria-label="Chat Magic Game Store" data-testid="floating-chat-panel"
      className="float-glass fixed z-50 flex flex-col overflow-hidden rounded-[1.5rem] border bg-card/95 text-card-foreground inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] md:inset-auto md:bottom-6 md:right-6 md:h-[min(640px,calc(100vh-3rem))] md:w-[400px]">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary"><MessageCircle className="h-5 w-5" /></span><div><p className="font-display text-base font-bold leading-tight">Magic Game Store</p><p className="text-xs text-muted-foreground">Support · réponse rapide</p></div></div>
        <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={() => setPanelOpen(false)} aria-label="Fermer le chat" data-testid="floating-chat-close"><X className="h-5 w-5" /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {user ? <ChatWorkspace /> : <div className="rounded-2xl border bg-background p-5" data-testid="floating-chat-login-required">
          <p className="text-sm" data-testid="floating-chat-login-message">Vous devez créer un compte ou vous connecter pour démarrer une conversation.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild className="rounded-full"><Link to="/connexion" state={{ from: pathname }} data-testid="floating-chat-login">Se connecter</Link></Button>
            <Button asChild variant="outline" className="rounded-full"><Link to="/inscription" state={{ from: pathname }} data-testid="floating-chat-register">Créer un compte</Link></Button>
          </div>
        </div>}
      </div>
    </section>}
  </>;
};
