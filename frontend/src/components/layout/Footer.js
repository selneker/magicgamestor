import { Link } from "react-router-dom";
import { Bug, Facebook, MessageCircle, Phone } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

export function Footer() {
  const { t } = useLang();
  const { isAdmin } = useAuth();
  const ticker = t("footer.ticker");
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white pb-28 md:pb-10">
      <div className="overflow-hidden border-b border-slate-100 py-3">
        <div className="marquee flex w-max whitespace-nowrap font-display text-sm font-bold uppercase tracking-[0.25em] text-slate-300">
          <span className="px-4">{ticker.repeat(3)}</span><span className="px-4">{ticker.repeat(3)}</span>
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div>
          <p className="font-display text-xl font-bold text-slate-900">Magic<span className="text-primary">Game</span>Store</p>
          <p className="mt-3 max-w-xs text-sm text-slate-500">{t("footer.tagline")}</p>
          <div className="mt-5 flex gap-2">
            <a href="https://wa.me/261377519833" data-testid="footer-whatsapp" className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25d366]/10 text-[#128c7e] transition-colors hover:bg-[#25d366] hover:text-white" aria-label="WhatsApp"><MessageCircle className="h-5 w-5" /></a>
            <a href="https://web.facebook.com/profile.php?id=61564007603785" data-testid="footer-facebook" className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-colors hover:bg-blue-600 hover:text-white" aria-label="Facebook"><Facebook className="h-5 w-5" /></a>
            <a href="tel:+261383905692" data-testid="footer-phone" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-colors hover:bg-slate-900 hover:text-white" aria-label="Phone"><Phone className="h-5 w-5" /></a>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("footer.nav")}</p>
          <ul className="mt-4 space-y-2 text-sm font-medium text-slate-600">
            <li><Link to="/boutique" className="hover:text-primary">{t("nav.shop")}</Link></li>
            <li><Link to="/evenements" className="hover:text-primary">{t("nav.events")}</Link></li>
            <li><Link to="/suivi" className="hover:text-primary">{t("nav.track")}</Link></li>
            <li><Link to="/compte" className="hover:text-primary">{t("nav.account")}</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("footer.support")}</p>
          <ul className="mt-4 space-y-2 text-sm font-medium text-slate-600">
            <li><Link to={isAdmin ? "/admin/messages" : "/chat"} data-testid="footer-chat-link" className="inline-flex items-center gap-2 hover:text-primary"><MessageCircle className="h-4 w-4" />Chat · Magic Game Store</Link></li>
            <li><a href="https://wa.me/261377519833" className="inline-flex items-center gap-2 hover:text-primary"><MessageCircle className="h-4 w-4" />WhatsApp</a></li>
            <li><a href="tel:+261383905692" className="inline-flex items-center gap-2 hover:text-primary"><Phone className="h-4 w-4" />038 39 056 92</a></li>
            <li><a href="https://wa.me/261377519833" className="inline-flex items-center gap-2 hover:text-primary"><Bug className="h-4 w-4" />{t("footer.report")}</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 text-xs text-slate-400 sm:flex-row sm:justify-between sm:px-6">
        <span>© 2026 Magic Game Store</span><span>{t("footer.made")}</span>
      </div>
    </footer>
  );
}
