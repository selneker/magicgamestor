import { Link } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

/* ── PL-005-FE-03 refonte Slush — footer structure Slush (01-accueil 1228-1260)
   Cartes sociales (Facebook / WhatsApp / carte pleine largeur Téléphone) +
   colonne verte (.footer-row-col.is--last) avec titre, liens, copyright.
   Classes EXACTES de la maquette (footer-row, footer-social-grid,
   footer-social-link, link-list, footer-cr, data-card-reveal) — le CSS de
   design-system.css / mg-components.css fait le reste.
   Uniquement des LIENS RÉELS du site : Facebook, WhatsApp et le 038 39 056 92
   sont ceux du site (jamais de handle ni numéro inventé). La mention
   « Maquette PL-DS-003 — ne pas déployer » de la maquette n'est PAS portée. */

export function Footer() {
  const { t } = useLang();
  const { isAdmin } = useAuth();
  return (
    <footer className="footer" id="support" data-testid="site-footer">
      <div className="container">
        <div className="footer-row-wrap" data-card-reveal="wrap">
          <div className="footer-row">
            <div className="footer-social-grid" data-card-reveal="wrap" data-testid="footer-social-grid">
              <a href="https://web.facebook.com/profile.php?id=61564007603785" target="_blank" rel="noreferrer" className="footer-social-link" data-card-reveal="card" data-testid="footer-facebook">
                Facebook
              </a>
              <a href="https://wa.me/261377519833" target="_blank" rel="noreferrer" className="footer-social-link" data-card-reveal="card" data-testid="footer-whatsapp">
                WhatsApp
              </a>
              <a href="tel:+261383905692" className="footer-social-link is--wide" data-card-reveal="card" data-testid="footer-phone">
                {t("footer.phoneLabel")} · 038 39 056 92
              </a>
              <a href="#" className="footer-social-link is--wide" data-card-reveal="card" data-testid="footer-discord">
                {t("footer.discord")}
              </a>
            </div>
            <div className="footer-row-col is--last" data-card-reveal="card">
              <div className="footer-block-content">
                <h3 className="h-m">
                  {t("footer.headlineA")} <br /><span className="u--text--italic">{t("footer.headlineB")}</span>
                </h3>
              </div>
              <div>
                <ul role="list" className="link-list">
                  <li><Link to="/boutique" className="p-l text-link link">{t("nav.shop")}</Link></li>
                  <li><Link to="/evenements" className="p-l text-link link">{t("nav.eventsFull")}</Link></li>
                  <li><Link to="/suivi" className="p-l text-link link">{t("nav.orders")}</Link></li>
                </ul>
              </div>
              <div className="footer-cr"><p className="p-m u--weight--bold u--text--caps">© 2026 Magic Game Store</p></div>
              <ul role="list" className="link-list">
                <li><Link to="/#faq" className="p-m text-link link">FAQ</Link></li>
                <li><Link to="/privacy" data-testid="footer-privacy-link" className="p-m text-link link">{t("footer.privacy")}</Link></li>
                <li><Link to="/terms" data-testid="footer-terms-link" className="p-m text-link link">{t("footer.terms")}</Link></li>
                <li><Link to={isAdmin ? "/admin/messages" : "/chat"} data-testid="footer-chat-link" className="p-m text-link link">{t("footer.support")}</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
