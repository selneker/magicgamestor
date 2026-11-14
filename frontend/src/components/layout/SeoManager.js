import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";
import {
  SITE_NAME,
  SITE_URL,
  canonicalFor,
  isPrivatePath,
  keywordsFor,
  setCanonical,
  setMeta,
  setProperty,
} from "@/lib/seo";

// Tenue du <head> route par route : canonical, robots, Open Graph (URL + locale)
// et mots-clés. Les titres/descriptions restent la responsabilité des pages
// (`usePageMeta`), qui connaissent leur contenu et leur langue.
export default function SeoManager() {
  const { pathname, search } = useLocation();
  const { lang } = useLang();

  useEffect(() => {
    const canonical = canonicalFor(pathname, search);
    const description = document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");

    setCanonical(canonical);
    setProperty("og:url", canonical);
    setProperty("og:locale", lang === "en" ? "en_US" : "fr_FR");
    setProperty("og:locale:alternate", lang === "en" ? "fr_FR" : "en_US");
    setProperty("og:site_name", SITE_NAME);
    setProperty("og:image", `${SITE_URL}/og-image.png?v=1`);
    setMeta("twitter:image", `${SITE_URL}/og-image.png?v=1`);
    if (description) setProperty("og:description", description);
    setMeta("keywords", keywordsFor(pathname, lang));

    // Les pages privées (compte, commande, admin, chat…) et toutes les pages
    // transactionnelles sortent de l'index ; les pages publiques y entrent.
    setMeta(
      "robots",
      isPrivatePath(pathname)
        ? "noindex,nofollow"
        : "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1",
    );
  }, [pathname, search, lang]);

  return null;
}
