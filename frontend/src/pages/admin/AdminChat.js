import { useLayoutEffect, useRef, useState } from "react";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { useLang } from "@/context/LanguageContext";

export default function AdminChat() {
  const { t } = useLang();
  // Desktop (>=768px) : hauteur de l'espace de travail = viewport moins tout
  // ce qui est au-dessus (en-tête client, en-tête admin, bandeau push). Mesuré
  // — pas deviné — car la hauteur du bandeau push varie selon son état.
  const zone = useRef(null);
  const [chatH, setChatH] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = zone.current;
      if (el) setChatH(Math.max(320, window.innerHeight - el.getBoundingClientRect().top));
    };
    measure();
    // AdminPush charge son état async : sa hauteur peut changer après le
    // premier rendu, on re-mesure.
    const timers = [setTimeout(measure, 400), setTimeout(measure, 1500)];
    window.addEventListener("resize", measure);
    return () => { timers.forEach(clearTimeout); window.removeEventListener("resize", measure); };
  }, []);
  return <section data-testid="admin-chat-page">
    <h2 className="mb-4 font-display text-lg font-bold">{t("chat.adminTitle")}</h2>
    <div ref={zone} style={chatH ? { "--chat-h": `${chatH}px` } : undefined}>
      <ChatWorkspace admin />
    </div>
  </section>;
}
