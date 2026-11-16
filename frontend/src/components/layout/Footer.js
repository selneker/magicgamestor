import { Link } from "react-router-dom";
import { MessageCircle, Phone } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";

/* ── PL-005-FE-03 — Pied de page (maquette PL-DS-003) ─────────────────────
   Structure maquette : cartes liens sociaux (Facebook / WhatsApp / carte
   pleine largeur Téléphone) + colonne titre et liens. Uniquement des
   LIENS RÉELS du site (mêmes destinations et mêmes data-testid qu'avant) :
   aucun handle ni numéro inventé — le 038 39 056 92 est celui du site. */

// Carte lien social (maquette .footer-social-link) : grande cible, encre sur
// crème du thème, survol = accent de la maquette avec texte fixe encre.
const socialCard = "flex min-h-24 items-center justify-center rounded-[28px] border bg-card px-6 py-6 text-sm font-bold uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-[color:var(--brand-yellow)] hover:text-[color:var(--brand-ink)] motion-safe:duration-200";

export function Footer() {
  const { t } = useLang();
  const { isAdmin } = useAuth();
  const tickerMessages = t("footer.tickerMessages") || [];
  const linkItem = "hover:bg-primary hover:text-[color:var(--brand-ink)]";
  return (
    <footer className="mt-24 border-t border-foreground bg-card pb-28 md:pb-10">
      <div className="border-b border-foreground bg-primary px-4 py-3 text-[color:var(--brand-ink)]">
        <ul className="mx-auto grid max-w-7xl gap-1.5 text-center text-xs font-semibold sm:grid-cols-3 sm:gap-3 sm:text-left" aria-label={t("footer.tickerLabel")}>
          {tickerMessages.map((message) => <li key={message} className="leading-snug">{message}</li>)}
        </ul>
      </div>
      <div className="mx-auto grid max-w-7xl gap-3 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Cartes liens sociaux (maquette : grille 2×2 + carte large) */}
        <div className="grid grid-cols-2 gap-3 self-start" data-testid="footer-social-grid">
          <a href="https://web.facebook.com/profile.php?id=61564007603785" data-testid="footer-facebook" className={socialCard}>Facebook</a>
          <a href="https://wa.me/261377519833" data-testid="footer-whatsapp" className={socialCard}>WhatsApp</a>
          <a href="tel:+261383905692" data-testid="footer-phone" className={`${socialCard} col-span-2`}>{t("footer.phoneLabel")} · 038 39 056 92</a>
        </div>
        {/* Colonne titre + liens */}
        <div className="rounded-[28px] border bg-card p-6 sm:p-8">
          <p className="flex items-center gap-2.5 font-display text-lg font-black uppercase tracking-tight">
            <Logo className="h-8 w-8 shrink-0 text-foreground" label="Magic Game Store" />
            <span>Magic<span className="bg-primary px-1 text-[color:var(--brand-ink)]">Game</span>Store</span>
          </p>
          <h3 className="mt-6 font-display text-3xl font-bold leading-tight tracking-tight">
            {t("footer.headlineA")} <br /><em className="italic">{t("footer.headlineB")}</em>
          </h3>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{t("footer.tagline")}</p>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            <li><Link to="/boutique" className={linkItem}>{t("nav.shop")}</Link></li>
            <li><Link to="/evenements" className={linkItem}>{t("nav.events")}</Link></li>
            <li><Link to="/suivi" className={linkItem}>{t("nav.track")}</Link></li>
            <li><Link to="/compte" className={linkItem}>{t("nav.account")}</Link></li>
          </ul>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            <li><Link to={isAdmin ? "/admin/messages" : "/chat"} data-testid="footer-chat-link" className={`inline-flex items-center gap-2 ${linkItem}`}><MessageCircle className="h-4 w-4" strokeWidth={1.75} />{t("footer.support")}</Link></li>
            <li><a href="https://wa.me/261377519833" className={linkItem}>{t("footer.report")}</a></li>
            <li><Link to="/terms" data-testid="footer-terms-link" className={linkItem}>{t("footer.terms")}</Link></li>
            <li><Link to="/privacy" data-testid="footer-privacy-link" className={linkItem}>{t("footer.privacy")}</Link></li>
          </ul>
          <p className="mt-8 border-t border-[color:var(--rule)] pt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            © 2026 Magic Game Store · {t("footer.made")}
          </p>
        </div>
      </div>
    </footer>
  );
}
