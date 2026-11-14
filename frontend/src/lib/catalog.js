import { useEffect } from "react";
import { DEFAULT_TITLE, PAGE_JSONLD_ID, SITE_NAME, setJsonLd, setMeta, setProperty } from "@/lib/seo";

export const DEFAULT_GAME = "pubg-mobile";
export const gameOf = (p) => p?.game_id || DEFAULT_GAME;

// Game-configured MGS product type label (falls back to the raw key, never to a PUBG list).
export const typeLabel = (game, type, lang) => {
  const def = (game?.product_types || []).find((t) => t.key === type);
  if (!def) return type;
  return (lang === "en" && def.label_en) || def.label;
};

export const currencyOf = (game) => game?.currency_label || (game?.id === DEFAULT_GAME ? "UC" : "");

// Headline figure of a product card: currency amount, subscription months, or the type label.
export const productFigure = (p, game, lang) => {
  if (p.uc_amount) return { value: p.uc_amount, unit: currencyOf(game) || typeLabel(game, p.type, lang) };
  if (p.duration_months) return { value: p.duration_months, unit: lang === "en" ? "months" : "mois" };
  return { value: typeLabel(game, p.type, lang), unit: "" };
};

// Métadonnées d'une page : titre, description, Open Graph / Twitter et, si la
// page en fournit, un bloc JSON-LD (schema.org) propre à la page. La canonical,
// les robots et les mots-clés sont gérés route par route par <SeoManager/>.
export function usePageMeta(title, description, options = {}) {
  const jsonLd = options?.jsonLd;
  const enabled = options?.enabled !== false;
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : "";
  useEffect(() => {
    if (!enabled) return undefined;
    const fullTitle = title ? `${title} · ${SITE_NAME}` : DEFAULT_TITLE;
    document.title = fullTitle;
    setProperty("og:title", fullTitle);
    setMeta("twitter:title", fullTitle);
    if (description) {
      setMeta("description", description);
      setProperty("og:description", description);
      setMeta("twitter:description", description);
    }
    if (jsonLdKey) setJsonLd(PAGE_JSONLD_ID, JSON.parse(jsonLdKey));
    return () => {
      // Le JSON-LD de page ne doit pas survivre à la navigation : sans ça,
      // Google lit le produit d'une page précédente sur la page suivante.
      // (L'effet suivant le réécrit s'il y a lieu.)
      document.getElementById(PAGE_JSONLD_ID)?.remove();
    };
  }, [title, description, jsonLdKey, enabled]);
}
