import { Link } from "react-router-dom";
import { MessageCircle, Phone } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

export function Footer() {
  const { t } = useLang();
  const { isAdmin } = useAuth();
  const ticker = t("footer.ticker");
  return (
    <footer className="mt-24 border-t border-foreground bg-card pb-28 md:pb-10">
      <div className="overflow-hidden border-b border-foreground bg-primary py-2">
        <div className="marquee flex w-max whitespace-nowrap font-display text-[11px] font-black uppercase tracking-[0.2em] text-[#0A0A0A]">
          <span className="px-3">{ticker.repeat(3)}</span><span className="px-3">{ticker.repeat(3)}</span>
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
        <div>
          <p className="font-display text-lg font-black uppercase tracking-tight">Magic<span className="bg-primary px-1 text-[#0A0A0A]">Game</span>Store</p>
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">{t("footer.tagline")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <a href="https://wa.me/261377519833" data-testid="footer-whatsapp" className="border border-foreground px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] transition-colors hover:bg-primary hover:text-[#0A0A0A]">WhatsApp</a>
            <a href="https://web.facebook.com/profile.php?id=61564007603785" data-testid="footer-facebook" className="border border-foreground px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] transition-colors hover:bg-primary hover:text-[#0A0A0A]">Facebook</a>
            <a href="tel:+261383905692" data-testid="footer-phone" className="border border-foreground px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] transition-colors hover:bg-primary hover:text-[#0A0A0A]">038 39 056 92</a>
          </div>
        </div>
        <div>
          <p className="eyebrow">{t("footer.nav")}</p>
          <ul className="mt-5 space-y-2.5 text-sm font-semibold">
            <li><Link to="/boutique" className="hover:bg-primary hover:text-[#0A0A0A]">{t("nav.shop")}</Link></li>
            <li><Link to="/evenements" className="hover:bg-primary hover:text-[#0A0A0A]">{t("nav.events")}</Link></li>
            <li><Link to="/suivi" className="hover:bg-primary hover:text-[#0A0A0A]">{t("nav.track")}</Link></li>
            <li><Link to="/compte" className="hover:bg-primary hover:text-[#0A0A0A]">{t("nav.account")}</Link></li>
          </ul>
        </div>
        <div>
          <p className="eyebrow">{t("footer.support")}</p>
          <ul className="mt-5 space-y-2.5 text-sm font-semibold">
            <li><Link to={isAdmin ? "/admin/messages" : "/chat"} data-testid="footer-chat-link" className="inline-flex items-center gap-2 hover:bg-primary hover:text-[#0A0A0A]"><MessageCircle className="h-4 w-4" strokeWidth={1.75} />Chat support</Link></li>
            <li><a href="https://wa.me/261377519833" className="inline-flex items-center gap-2 hover:bg-primary hover:text-[#0A0A0A]"><MessageCircle className="h-4 w-4" strokeWidth={1.75} />WhatsApp</a></li>
            <li><a href="tel:+261383905692" className="inline-flex items-center gap-2 hover:bg-primary hover:text-[#0A0A0A]"><Phone className="h-4 w-4" strokeWidth={1.75} />038 39 056 92</a></li>
            <li><a href="https://wa.me/261377519833" className="hover:bg-primary hover:text-[#0A0A0A]">{t("footer.report")}</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-1 border-t border-foreground px-4 py-5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
        <span>© 2026 Magic Game Store</span><span>{t("footer.made")}</span>
      </div>
    </footer>
  );
}
