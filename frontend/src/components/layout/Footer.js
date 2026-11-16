import { Link } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

/* ── PL-005-FE-03 refonte Slush — footer structure Slush (01-accueil 1228-1260)
   Cartes sociales en ICONES (retour utilisateur : « comme la photo Slush ») :
   grille 2×2 de cartes carrées crème, grande icône pleine encre centrée, aucun
   texte sur la carte — le nom passe en aria-label (icônes = éléments
   significatifs, ils doivent avoir une alternative textuelle). Icônes = SVG
   inline (logos de marque + combiné), AUCUNE dépendance ajoutée.
   Colonnes verte (.footer-row-col.is--last) avec titre, liens, copyright :
   classes EXACTES de la maquette (footer-row, footer-social-grid,
   footer-social-link, link-list, footer-cr, data-card-reveal) — le CSS de
   design-system.css / mg-components.css fait le reste.
   Uniquement des LIENS RÉELS du site : Facebook, WhatsApp et le 038 39 056 92
   sont ceux du site (jamais de handle ni numéro inventé). La mention
   « Maquette PL-DS-003 — ne pas déployer » de la maquette n'est PAS portée. */

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  style: { width: "6em", height: "6em" },
};

/* Icônes encre sur cartes crème (couleur portée par .footer-social-link). */
function FacebookIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

export function Footer() {
  const { t } = useLang();
  const { isAdmin } = useAuth();
  return (
    <footer className="footer" id="support" data-testid="site-footer">
      <div className="container">
        <div className="footer-row-wrap" data-card-reveal="wrap">
          <div className="footer-row">
            <div className="footer-social-grid" data-card-reveal="wrap" data-testid="footer-social-grid">
              <a href="https://web.facebook.com/profile.php?id=61564007603785" target="_blank" rel="noreferrer" className="footer-social-link flex items-center justify-center" aria-label={t("footer.facebook")} data-card-reveal="card" data-testid="footer-facebook">
                <FacebookIcon />
              </a>
              <a href="https://wa.me/261377519833" target="_blank" rel="noreferrer" className="footer-social-link flex items-center justify-center" aria-label={t("footer.whatsapp")} data-card-reveal="card" data-testid="footer-whatsapp">
                <WhatsAppIcon />
              </a>
              <a href="tel:+261383905692" className="footer-social-link flex items-center justify-center" aria-label={`${t("footer.phoneLabel")} · 038 39 056 92`} data-card-reveal="card" data-testid="footer-phone">
                <PhoneIcon />
              </a>
              <a href="#" className="footer-social-link flex items-center justify-center" aria-label={t("footer.discord")} data-card-reveal="card" data-testid="footer-discord">
                <DiscordIcon />
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
